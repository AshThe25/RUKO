import React, {useMemo} from 'react';
import {StyleSheet, View} from 'react-native';
import type {ToolName, TraceEntry} from '@contracts';
import {
  Button,
  Card,
  ErrorState,
  InvestigationStep,
  RiskScore,
  Screen,
  SignalBar,
  Txt,
  type StepStatus,
} from '@/components';
import {colors, space} from '@/theme';
import {useProtectionStore} from '@/store/protectionStore';
import {useProtectionController} from '@/store/useProtectionController';
import {formatLatency} from '@/utils/format';

const TOOL_ORDER: ToolName[] = [
  'paymentTool',
  'callContextTool',
  'payeeTool',
  'behaviourTool',
  'notificationTool',
  'conversationTool',
];

const TOOL_LABELS: Record<ToolName, string> = {
  paymentTool: 'Payment',
  callContextTool: 'Caller',
  payeeTool: 'Recipient',
  behaviourTool: 'Amount',
  notificationTool: 'Notifications',
  conversationTool: 'Conversation',
};

/**
 * The live "RUKO IS CHECKING" feed.
 *
 * The investigation itself finishes in milliseconds; this screen reveals what
 * it found one line at a time so a person can follow it, and prints the real
 * compute time underneath so the pacing is never mistaken for the analysis.
 */
export function InvestigationScreen() {
  const trace = useProtectionStore(s => s.trace);
  const revealed = useProtectionStore(s => s.revealed);
  const result = useProtectionStore(s => s.result);
  const status = useProtectionStore(s => s.status);
  const error = useProtectionStore(s => s.error);
  const {endSession, runInvestigation} = useProtectionController();

  const visible = useMemo(() => trace.slice(0, revealed), [trace, revealed]);
  const steps = useMemo(() => deriveSteps(visible), [visible]);
  const finished = result !== null && revealed >= trace.length && trace.length > 0;

  if (status === 'error') {
    return (
      <Screen scroll={false}>
        <ErrorState
          title="Ruko could not finish checking"
          message={error ?? 'The investigation stopped before it reached a conclusion. No payment has been affected.'}
          onRetry={() => runInvestigation('MANUAL')}
        />
      </Screen>
    );
  }

  const conversation = result?.evidence.conversation;

  return (
    <Screen
      testID="investigation-screen"
      footer={
        finished && result.risk.policyAction === 'NONE' ? (
          <Button label="Done" onPress={() => endSession('NO_INTERRUPTION')} testID="investigation-done" />
        ) : undefined
      }>
      <Txt variant="label" tone="tertiary" uppercase>
        Ruko is checking
      </Txt>
      <Txt variant="title" style={styles.headline}>
        {finished ? 'Here is what Ruko found.' : 'Looking at this payment.'}
      </Txt>

      <View style={styles.steps}>
        {TOOL_ORDER.map(tool => (
          <InvestigationStep
            key={tool}
            label={TOOL_LABELS[tool]}
            status={steps[tool]?.status ?? 'pending'}
            summary={steps[tool]?.summary}
          />
        ))}
      </View>

      {conversation?.available ? (
        <Card title="Manipulation signals" style={styles.card}>
          <SignalBar label="Authority" value={conversation.scores.authority} />
          <SignalBar label="Coercion" value={conversation.scores.coercion} />
          <SignalBar label="Urgency" value={conversation.scores.urgency} />
          <SignalBar label="Payment instruction" value={conversation.scores.financialInstruction} />
          <SignalBar label="Secrecy" value={conversation.scores.secrecy} />
          <SignalBar label="Credential request" value={conversation.scores.credentialRequest} />
          <Txt variant="caption" tone="tertiary" style={styles.provenance}>
            {conversation.modelVersion} · {conversation.backend.toLowerCase()} ·{' '}
            {formatLatency(conversation.latencyMs)}
          </Txt>
        </Card>
      ) : null}

      {finished ? (
        <Card style={styles.card} testID="investigation-result">
          <RiskScore score={result.risk.score} level={result.risk.level} />
          <Txt variant="caption" tone="tertiary" style={styles.provenance}>
            Evaluated in {formatLatency(result.risk.computeMs)} from{' '}
            {result.risk.corroboratingFamilies.length} evidence{' '}
            {result.risk.corroboratingFamilies.length === 1 ? 'family' : 'families'} ·{' '}
            {result.risk.weightsVersion}
          </Txt>
          {result.risk.degraded ? (
            <View style={styles.degraded}>
              {result.risk.degradedReasons.map(reason => (
                <Txt key={reason} variant="caption" tone="secondary" style={styles.degradedLine}>
                  · {reason}
                </Txt>
              ))}
            </View>
          ) : null}
        </Card>
      ) : null}
    </Screen>
  );
}

/** Folds the raw trace into one row per tool. */
function deriveSteps(entries: TraceEntry[]): Partial<Record<ToolName, {status: StepStatus; summary?: string}>> {
  const steps: Partial<Record<ToolName, {status: StepStatus; summary?: string}>> = {};
  for (const entry of entries) {
    if (!entry.tool) {
      continue;
    }
    if (entry.kind === 'TOOL_START') {
      steps[entry.tool] = {status: 'running'};
    } else if (entry.kind === 'TOOL_RESULT') {
      steps[entry.tool] = {status: flags(entry.message) ? 'flagged' : 'done', summary: entry.message};
    } else if (entry.kind === 'ERROR') {
      steps[entry.tool] = {status: 'error', summary: entry.message};
    }
  }
  return steps;
}

/** Wording that indicates a finding rather than a clean check. */
const FLAG_PATTERNS = [
  /detected/i,
  /^first payment/i,
  /unknown caller/i,
  /your usual payment/i,
  /pressure language/i,
];

function flags(message: string): boolean {
  return FLAG_PATTERNS.some(p => p.test(message));
}

const styles = StyleSheet.create({
  headline: {marginTop: space.md},
  steps: {marginTop: space.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border},
  card: {marginTop: space.lg},
  provenance: {marginTop: space.md},
  degraded: {marginTop: space.md},
  degradedLine: {marginTop: 2},
});
