/** REST calls the console makes. Only one: redeeming a pairing code. */

const HTTP_BASE =
  process.env.NEXT_PUBLIC_RUKO_RELAY_HTTP?.replace(/\/$/, '') ?? 'http://localhost:8000';

export const WS_BASE =
  process.env.NEXT_PUBLIC_RUKO_RELAY_WS?.replace(/\/$/, '') ?? 'ws://localhost:8000';

export type ClaimResult = {
  sessionId: string;
  guardianToken: string;
  phoneDisplayName: string;
};

export class ClaimError extends Error {}

export async function claimPairingCode(
  pairingCode: string,
  guardianDisplayName: string,
): Promise<ClaimResult> {
  let response: Response;
  try {
    response = await fetch(`${HTTP_BASE}/guardian/pair/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairingCode, guardianDisplayName }),
    });
  } catch {
    throw new ClaimError("Can't reach the Ruko relay. Check that it is running.");
  }

  if (response.status === 404) {
    throw new ClaimError('That code is not valid. Ask for a fresh one on the phone.');
  }
  if (response.status === 422) {
    throw new ClaimError('A pairing code is six digits.');
  }
  if (!response.ok) {
    throw new ClaimError('Pairing failed. Try again in a moment.');
  }

  return (await response.json()) as ClaimResult;
}
