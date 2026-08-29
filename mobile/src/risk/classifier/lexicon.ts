/**
 * Manipulation-tactic lexicon for the deterministic fallback classifier.
 *
 * WHAT THIS IS: a hand-built, weighted pattern matcher over ASR text. It is a
 * genuine, useful, always-available signal source — and it is NOT a neural
 * model. It is reported as `backend: 'HEURISTIC'` everywhere it is used, and the
 * engineering screen shows it as such. We never dress it up as on-device AI.
 *
 * WHY IT EXISTS: it costs ~0.1 ms, needs no model file, works on any device on
 * first launch, and gives the ONNX classifier something to fall back to when a
 * model fails to load. A demo that hard-fails because a 23 MB file did not
 * unpack is a demo that does not happen.
 *
 * Patterns cover English and romanised Hinglish, matching the dataset in
 * ml/datasets/. Weights are strength-of-evidence, not probabilities; the
 * classifier saturates them into [0,1].
 */

import type { ManipulationLabel } from '../../contracts/index.ts';

export interface Pattern {
  re: RegExp;
  /** Evidence strength. 1.0 = on its own this is near-conclusive for the label. */
  w: number;
}

/**
 * Contexts that flip a would-be signal into a benign one. Checked against the
 * whole window before any label fires. Without these, "never share your OTP with
 * anyone" — literally fraud-awareness advice — scores as a credential request.
 */
export const BENIGN_CONTEXT: RegExp[] = [
  /\bnever (share|give|tell)\b/,
  /\bdo not share (your|the) (otp|pin|password|code)\b/,
  /\bwill never ask\b/,
  /\bkabhi (mat|nahi) (bata|share)\b/,
  /\bstay alert\b/,
  /\bit'?s a surprise\b/,
  /\bsurprise (for|party)\b/,
];

export const LEXICON: Record<ManipulationLabel, Pattern[]> = {
  authority: [
    { re: /\b(calling|call(ing)?|speaking|bol(ta|ti)? (raha|rahi)?)\s+(from|se)\b.{0,24}\b(bank|branch|head office)\b/, w: 0.85 },
    { re: /\bi am (an? )?(officer|inspector|executive|manager|agent)\b/, w: 0.8 },
    { re: /\b(cyber ?(crime|cell)|crime branch|cbi|police|narcotics|enforcement directorate|income tax|customs|trai|reserve bank|rbi)\b/, w: 0.75 },
    { re: /\b(fraud|security|verification|vigilance|compliance)\s+(department|desk|cell|division|wing|team)\b/, w: 0.7 },
    { re: /\bemployee id\b|\bofficer (id|code)\b/, w: 0.6 },
    { re: /\bmain\b.{0,20}\b(bank|police|officer|department)\b.{0,16}\b(se|ka|hoon|bol)\b/, w: 0.7 },
    { re: /\b(customer care|customer support|helpline)\b/, w: 0.4 },
  ],
  coercion: [
    { re: /\b(account|khaata|khata)\b.{0,30}\b(freeze|frozen|block(ed)?|suspend(ed)?|seal(ed)?|band)\b/, w: 0.9 },
    { re: /\b(freeze|block|suspend|deactivate|disconnect|terminate)\b.{0,30}\b(account|card|sim|number|connection|services?)\b/, w: 0.8 },
    { re: /\b(arrest(ed)?|warrant|custody|non ?bailable|money laundering|criminal (case|offence)|fir)\b/, w: 0.9 },
    { re: /\b(legal action|court|summons|penalty|seiz(e|ed|ure)|recovery agent)\b/, w: 0.7 },
    { re: /\b(police|department)\b.{0,24}\b(aa ?jayegi|ghar|address|residence)\b/, w: 0.75 },
    { re: /\bagar\b.{0,40}\b(nahi|mat)\b.{0,24}\b(to|toh)\b.{0,24}\b(action|case|block|freeze|arrest)\b/, w: 0.7 },
    { re: /\byou will (lose|be (arrested|liable|charged))\b/, w: 0.8 },
    { re: /\bho jayega\b.{0,12}\b(block|freeze|band|seal)\b|\b(block|freeze|band|seal)\b.{0,12}\bho jayega\b/, w: 0.8 },
  ],
  urgency: [
    { re: /\b(immediately|right now|at once|straight ?away|without delay)\b/, w: 0.75 },
    { re: /\bwithin (the next )?\w+ (minute|minutes|hour|hours)\b/, w: 0.8 },
    { re: /\bdo not (disconnect|cut|hang ?up|put me on hold|end the call)\b/, w: 0.95 },
    { re: /\bstay (on the line|connected)\b|\bkeep me on the (phone|line)\b/, w: 0.9 },
    { re: /\b(call|phone|line)\b.{0,12}\bmat (kaat|kato|katiye|hataiye)\b/, w: 0.9 },
    { re: /\b(abhi ke abhi|turant|jaldi (kijiye|karo|kar)|foran)\b/, w: 0.75 },
    { re: /\b(last|final) (date|chance|reminder|warning)\b/, w: 0.6 },
    { re: /\bno time\b|\btime nahi hai\b|\bhurry\b/, w: 0.5 },
  ],
  financialInstruction: [
    // Verb inflections matter: "transferring the rent" and "sending 500" are
    // both financial instructions and a bare \btransfer\b misses them.
    { re: /\b(transfer|send|remit|deposit|pay|move|settle|forward)(s|ed|ing|red|ring)?\b.{0,30}\b(rupees|rs|inr|amount|balance|paisa|paise|money|rent|fee|fees|bill|salary)\b/, w: 0.8 },
    { re: /\b(transfer|send|deposit|remit|pay|bhej|daal)(s|ed|ing|red|ring)?\b.{0,24}\b\d[\d,]{2,}\b/, w: 0.8 },
    { re: /\b(transfer|send|deposit|remit|pay)(s|ed|ing|red|ring)?\b.{0,24}\b(to|into)\b.{0,24}\b(account|beneficiary|upi|landlord|vendor|supplier)\b/, w: 0.7 },
    { re: /\b(scan|use)\b.{0,16}\bqr( code)?\b/, w: 0.75 },
    { re: /\b(upi id|beneficiary|account number|account ending)\b.{0,30}\b(pay|send|transfer|deposit)\b/, w: 0.7 },
    { re: /\b(pay|send|transfer)\b.{0,20}\b(upi id|this account|the account|beneficiary)\b/, w: 0.75 },
    { re: /\b(processing|clearance|verification|gst|service) (fee|charge|charges|amount)\b/, w: 0.7 },
    { re: /\b(safe|secure|escrow|verification|government) account\b/, w: 0.85 },
    { re: /\b(bhej|transfer kar|daal) (dijiye|do|de|dena|dijie)\b/, w: 0.8 },
  ],
  secrecy: [
    { re: /\b(do not|don'?t|never)\b.{0,24}\b(tell|inform|discuss|mention|disclose|share)\b.{0,24}\b(anyone|anybody|family|wife|husband|son|daughter|father|mother|third party)\b/, w: 0.9 },
    { re: /\bconfidential (matter|investigation|case|communication)\b/, w: 0.8 },
    { re: /\bkeep (this|it) (between us|to yourself|strictly)\b/, w: 0.75 },
    { re: /\bdo not (go to|visit|call)\b.{0,24}\b(branch|customer care|bank)\b/, w: 0.85 },
    { re: /\b(kisi ko|ghar ?me|family ko)\b.{0,20}\bmat (bata|batana|bataiye|batao)\b/, w: 0.9 },
    { re: /\bdigital arrest\b/, w: 0.9 },
  ],
  credentialRequest: [
    { re: /\b(tell|give|share|read out|dictate|bata)\b.{0,30}\b(otp|o t p|one time (code|password)|six digit|verification code)\b/, w: 0.95 },
    { re: /\b(atm|upi|card)?\s?(pin|cvv)\b.{0,26}\b(bata|tell|give|share|confirm|need)\b/, w: 0.9 },
    { re: /\b(need|require|give me|share)\b.{0,20}\b(your )?(atm pin|upi pin|cvv|card number|password)\b/, w: 0.9 },
    { re: /\b(sixteen|16) digit\b/, w: 0.7 },
    { re: /\b(install|download|get)\b.{0,30}\b(anydesk|teamviewer|quicksupport|rustdesk|support tool)\b/, w: 0.9 },
    { re: /\b(share|give me)\b.{0,20}\b(your )?screen\b/, w: 0.8 },
    { re: /\b(aadhaar|pan)\b.{0,26}\b(number|card|photo)\b.{0,20}\b(bhej|send|share|bata)\b/, w: 0.7 },
    { re: /\botp\b.{0,20}\b(bataiye|batao|bata dijiye)\b/, w: 0.95 },
  ],
};
