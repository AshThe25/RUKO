"""The Ruko manipulation classifier: a compact encoder plus a 6-way head.

Deliberately small. The window it sees is one ASR utterance of at most ~64
tokens, and the task is closer to weighted phrase detection than to reasoning,
so encoder depth buys very little and costs latency and megabytes on a phone.
"""

from __future__ import annotations

import torch
import torch.nn as nn
from transformers import AutoConfig, AutoModel

LABELS = [
    "authority",
    "coercion",
    "urgency",
    "financialInstruction",
    "secrecy",
    "credentialRequest",
]


def mean_pool(hidden: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
    """Mask-aware mean pooling. Padding must not dilute the sentence vector."""
    mask = mask.unsqueeze(-1).to(hidden.dtype)
    return (hidden * mask).sum(1) / mask.sum(1).clamp(min=1e-9)


class RukoManipulationClassifier(nn.Module):
    """Encoder -> mean pool -> dropout -> linear. Six independent logits.

    Multi-label, not multi-class: a single window is very often authority AND
    coercion AND urgency at once, so the labels get a sigmoid each rather than a
    softmax across them.
    """

    def __init__(self, base_model: str, num_labels: int = len(LABELS), dropout: float = 0.1):
        super().__init__()
        self.base_model_name = base_model
        self.config = AutoConfig.from_pretrained(base_model)
        # Eager attention rather than the fused SDPA kernel, for two reasons:
        # MPS refuses to run attention dropout through the fused path, and eager
        # attention traces to a cleaner, more portable ONNX graph.
        self.encoder = AutoModel.from_pretrained(base_model, attn_implementation="eager")
        self.dropout = nn.Dropout(dropout)
        self.head = nn.Linear(self.config.hidden_size, num_labels)
        nn.init.normal_(self.head.weight, std=0.02)
        nn.init.zeros_(self.head.bias)

    def forward(self, input_ids: torch.Tensor, attention_mask: torch.Tensor) -> torch.Tensor:
        out = self.encoder(input_ids=input_ids, attention_mask=attention_mask)
        pooled = mean_pool(out.last_hidden_state, attention_mask)
        return self.head(self.dropout(pooled))

    def num_parameters(self) -> int:
        return sum(p.numel() for p in self.parameters())

    def trainable_parameters(self) -> int:
        return sum(p.numel() for p in self.parameters() if p.requires_grad)

    def freeze_bottom(self, n_layers: int) -> None:
        """Freeze the embeddings and the bottom `n_layers` encoder blocks.

        WHY: the training set is generated from ~160 base templates. A fully
        unfrozen 22M-parameter encoder memorises that surface form within one
        epoch -- measured: training loss 0.44 -> 0.018 between epochs 1 and 2,
        while validation F1 went DOWN. Freezing the lower layers keeps the
        pretrained sentence semantics, which is the part that generalises to
        phrasings the templates never contained, and leaves only the top blocks
        free to specialise. Capacity is the problem here, not optimisation.
        """
        if n_layers <= 0:
            return
        for p in self.encoder.embeddings.parameters():
            p.requires_grad = False
        for layer in self.encoder.encoder.layer[:n_layers]:
            for p in layer.parameters():
                p.requires_grad = False
