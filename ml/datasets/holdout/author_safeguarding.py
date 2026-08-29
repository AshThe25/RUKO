#!/usr/bin/env python3
"""Hand-authored evaluation set for grooming and sextortion.

    python3 ml/datasets/holdout/author_safeguarding.py

WHY THIS EXISTS
The app detects grooming and sextortion through the lexicon
(mobile/src/risk/classifier/lexicon.ts), but there was no ML coverage and no
evaluation for either. This file is the evaluation half of that gap.

LABEL MAPPING — no new label, no contract change:
  sextortion -> coercion   "comply or I publish this" is the same coercion
                           structure as "comply or your account is frozen".
  grooming   -> secrecy    isolating a child from trusted adults is the same
                           secrecy tactic as keeping a victim off the phone to
                           their bank.

THE NEGATIVES ARE THE POINT
Roughly a third of this file is safeguarding and awareness copy: helpline
adverts, school posters, parental guidance. That text uses the *exact*
vocabulary of the abuse it warns about — "if someone threatens to share your
photos" appears verbatim in both an extortion message and the poster telling
you to report it. A model that learns vocabulary instead of intent will flag
the poster, and flagging a child-safety helpline is a materially worse failure
than missing a threat. These rows are labelled all-zero and any regression on
them should block a release.

Every example is written by hand and never fed to the generator.

Label shortcodes:  C coercion   S secrecy   U urgency   R credentialRequest
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))  # ml/
from paths import ML_DIR  # noqa: E402

LABELS = ["authority", "coercion", "urgency", "financialInstruction",
          "secrecy", "credentialRequest"]
CODE = {"A": "authority", "C": "coercion", "U": "urgency",
        "F": "financialInstruction", "S": "secrecy", "R": "credentialRequest"}

# (text, codes, lang, kind)
EXAMPLES = [
    # ---------------- sextortion -> coercion --------------------------- #
    ("i saved every picture you sent me and i can post them whenever i want", "C", "en", "scam"),
    ("stop replying and your family sees the whole folder tonight", "CU", "en", "scam"),
    ("i already have your contact list downloaded so think carefully", "C", "en", "scam"),
    ("one click and this goes to your college group chat", "CU", "en", "scam"),
    ("keep talking to me or everyone finds out what you look like", "CS", "en", "scam"),
    ("you send more or the ones i have go public, your choice", "C", "en", "scam"),
    ("i know where you study and i know who your friends are", "C", "en", "scam"),
    ("do not block me, blocking me makes this worse for you", "CU", "en", "scam"),
    ("your reputation is in my hands right now", "C", "en", "scam"),
    ("pay me and i delete everything, refuse and i upload", "CF", "en", "scam"),
    ("tumhari saari photos mere paas hai, soch lo", "C", "hinglish", "scam"),
    ("mana kiya to sab dost dekh lenge, samajh rahe ho", "C", "hinglish", "scam"),
    ("ghar pe bata dunga sab kuch agar reply nahi kiya", "CU", "hinglish", "scam"),
    ("izzat ka sawaal hai tumhara, mera nahi", "C", "hinglish", "scam"),
    ("abhi paisa bhejo warna video viral kar dunga", "CUF", "hinglish", "scam"),

    # ---------------- grooming -> secrecy ------------------------------ #
    ("you are more mature than the other kids your age, they would not understand us", "S", "en", "scam"),
    ("do not mention me when your mum asks who you were talking to", "S", "en", "scam"),
    ("this stays between us, that is what makes it special", "S", "en", "scam"),
    ("clear the messages before anyone picks up your phone", "S", "en", "scam"),
    ("are your parents in the house right now or are you by yourself", "S", "en", "scam"),
    ("switch to the other app where the chats vanish on their own", "S", "en", "scam"),
    ("if your teacher sees this she will get the wrong idea, so hide it", "S", "en", "scam"),
    ("send it now while nobody is watching your screen", "SU", "en", "scam"),
    ("i will buy you the game but you cannot tell anyone where it came from", "S", "en", "scam"),
    ("you can trust me more than the adults around you", "S", "en", "scam"),
    ("mummy papa ko mat batana warna baat khatam", "S", "hinglish", "scam"),
    ("apna secret hai ye, kisi teacher ko nahi", "S", "hinglish", "scam"),
    ("phone me koi dekh to nahi raha abhi", "S", "hinglish", "scam"),
    ("chat delete karke sona, subah phir baat karenge", "S", "hinglish", "scam"),

    # ---------------- combined pressure -------------------------------- #
    ("send another photo right now and i will not tell anyone, delay and i will", "CSU", "en", "scam"),
    ("do not tell your parents, just transfer the money and it all goes away", "CSF", "en", "scam"),
    ("give me your instagram password so i can delete it myself, trust me", "SR", "en", "scam"),

    # ================== NEGATIVES: safeguarding copy ==================== #
    # Same vocabulary, opposite intent. All-zero on purpose.
    ("if someone threatens to share your photos, tell a trusted adult and report it", "", "en", "safe"),
    ("no one has the right to blackmail you with pictures, help is available", "", "en", "safe"),
    ("sharing intimate images without consent is a crime and you can report it", "", "en", "safe"),
    ("if you are being blackmailed online, contact the cyber tipline immediately", "", "en", "safe"),
    ("childline is free and confidential if you need someone to talk to", "", "en", "safe"),
    ("a safe adult will never ask you to keep secrets from your parents", "", "en", "safe"),
    ("if an adult asks you to delete your chats, that is a warning sign", "", "en", "safe"),
    ("talk to a teacher or parent if someone online makes you uncomfortable", "", "en", "safe"),
    ("remember that you are never the one at fault if this happens to you", "", "en", "safe"),
    ("block the account, take a screenshot as evidence, and tell someone", "", "en", "safe"),
    ("our school is running a session on online safety and grooming this friday", "", "en", "safe"),
    ("parents should ask their children who they are chatting with online", "", "en", "safe"),
    ("this helpline supports young people facing online sexual abuse", "", "en", "safe"),
    ("never send personal photos to someone you have not met in real life", "", "en", "safe"),
    ("the police cyber cell can act on sextortion complaints, do not stay silent", "", "en", "safe"),
    ("agar koi aapko photos ke naam pe dhamka raha hai to report kijiye", "", "hinglish", "safe"),
    ("bacchon ko sikhaiye ki koi secret rakhne ko kahe to bade ko batayein", "", "hinglish", "safe"),
    ("kisi ajnabi ko apni personal photo mat bhejiye, ye safe nahi hai", "", "hinglish", "safe"),
    ("online safety workshop kal school me hai, sab log aaiye", "", "hinglish", "safe"),

    # ---------------- negatives: ordinary conversation ----------------- #
    ("send me the photos from the trip when you get a chance", "", "en", "safe"),
    ("do not tell mum about the birthday cake, it is a surprise", "", "en", "safe"),
    ("are you home? i am outside with the parcel", "", "en", "safe"),
    ("delete those blurry screenshots, they are taking up space", "", "en", "safe"),
    ("i saved the photos you sent from the wedding, they came out lovely", "", "en", "safe"),
    ("can you move the chat to whatsapp, telegram keeps logging me out", "", "en", "safe"),
    ("ye photo group me daal dena, sab dekhna chahte hai", "", "hinglish", "safe"),
    ("akele ho ghar pe? main aata hoon chai peene", "", "hinglish", "safe"),
]


def main() -> int:
    out = ML_DIR / "datasets" / "holdout" / "safeguarding_holdout.jsonl"
    rows = []
    for i, (text, codes, lang, kind) in enumerate(EXAMPLES):
        labels = {label: 0 for label in LABELS}
        for c in codes:
            labels[CODE[c]] = 1
        rows.append({
            "id": f"safeguard-{i:04d}",
            "text": text,
            "labels": labels,
            "families": ["hand-authored"],
            "lang": lang,
            "kind": kind,
            "n_utterances": 1,
            "source": "hand-authored-safeguarding",
            "split": "safeguarding",
        })

    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")

    pos = sum(1 for r in rows if any(r["labels"].values()))
    print(f"safeguarding {len(rows):4d} rows  {pos} positive  {len(rows) - pos} negative")
    print(f"  coercion  {sum(r['labels']['coercion'] for r in rows):3d}  (sextortion)")
    print(f"  secrecy   {sum(r['labels']['secrecy'] for r in rows):3d}  (grooming)")
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
