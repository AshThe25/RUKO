import {LexicalClassifier, scoreTranscript, transcriptReliability} from '@/services/stubs/lexicalClassifier';

describe('manipulation scoring', () => {
  it('scores pressure tactics in a scam call', () => {
    const {scores} = scoreTranscript(
      'Hello sir, I am calling from your bank. Your account will be frozen within ten minutes. ' +
        'You must transfer 48000 immediately. Do not disconnect this call and do not tell anyone.',
    );
    expect(scores.authority).toBeGreaterThan(0.4);
    expect(scores.coercion).toBeGreaterThan(0.6);
    expect(scores.urgency).toBeGreaterThan(0.4);
    expect(scores.financialInstruction).toBeGreaterThan(0.4);
    expect(scores.secrecy).toBeGreaterThan(0.4);
  });

  it('does not treat a friend asking for money as pressure', () => {
    const {scores} = scoreTranscript('Hey can you send 500 for dinner whenever, no rush at all');
    expect(scores.coercion).toBe(0);
    expect(scores.authority).toBe(0);
    expect(scores.urgency).toBe(0);
    // Money is mentioned, but the mitigators stop it reading as an instruction.
    expect(scores.financialInstruction).toBeLessThan(0.3);
  });

  it('catches a request for an OTP', () => {
    const {scores} = scoreTranscript('Please read out the OTP you just received on your phone');
    expect(scores.credentialRequest).toBeGreaterThan(0.5);
  });

  it('never saturates to certainty', () => {
    const repeated = Array(20).fill('your account will be frozen immediately').join('. ');
    const {scores} = scoreTranscript(repeated);
    expect(scores.coercion).toBeLessThan(1);
  });

  it('reports low reliability on a very short transcript', () => {
    expect(transcriptReliability('hello')).toBeLessThan(0.3);
    expect(transcriptReliability('x'.repeat(400))).toBeGreaterThan(0.8);
  });

  it('marks evidence unavailable when nothing has been heard', async () => {
    const classifier = new LexicalClassifier();
    await classifier.loadModel();
    const evidence = await classifier.classify('   ');
    expect(evidence.available).toBe(false);
    expect(evidence.unavailableReason).toBeTruthy();
  });

  it('reports itself as a heuristic, never as a trained model', async () => {
    const classifier = new LexicalClassifier();
    const info = await classifier.loadModel();
    expect(info.backend).toBe('HEURISTIC');
    expect(info.modelVersion).toBe('stub-lexicon-v0');
    const evidence = await classifier.classify('calling from your bank');
    expect(evidence.source).toBe('ON_DEVICE_HEURISTIC');
  });
});
