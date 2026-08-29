#!/usr/bin/env python3
"""Hand-authored holdout set for the Ruko manipulation classifier.

    python3 ml/datasets/holdout/author_holdout.py

WHY THIS EXISTS
The main dataset is generated from templates. Even with family-disjoint splits,
the generated test set shares a *style* with the training set, so its F1 is
optimistic. Every example below was written by hand, deliberately phrased
differently from anything in templates.py, and never fed to the generator.

The number reported on THIS file is the honest number. Expect it to be
noticeably lower than the generated test split. That gap is information, not a
failure -- it is the cost of synthetic training data, and we report both.

Label shortcodes:  A authority   C coercion   U urgency
                   F financialInstruction   S secrecy   R credentialRequest
"""

import json
from pathlib import Path

LABELS = ["authority", "coercion", "urgency", "financialInstruction",
          "secrecy", "credentialRequest"]
CODE = {"A": "authority", "C": "coercion", "U": "urgency",
        "F": "financialInstruction", "S": "secrecy", "R": "credentialRequest"}

# (text, codes, lang, kind)
EXAMPLES = [
    # ---------------- scam: authority + coercion -------------------------
    ("sir kindly listen carefully this is the vigilance wing and your name is attached to a case file", "A", "en", "scam"),
    ("madam i am speaking on behalf of the banking ombudsman office regarding a complaint", "A", "en", "scam"),
    ("we are the anti fraud unit your case number is seven seven four one", "A", "en", "scam"),
    ("your netbanking will be terminated by end of day and the amount will be recovered legally", "C", "en", "scam"),
    ("failure to comply will result in a first information report being lodged against you", "C", "en", "scam"),
    ("i am officer from headquarters your account is under surveillance and will be sealed shortly", "AC", "en", "scam"),
    ("this is the fraud desk of your bank someone has attempted a withdrawal and we must lock everything", "AC", "en", "scam"),
    ("main crime branch se bol raha hoon aapka naam ek case me aaya hai", "A", "hinglish", "scam"),
    ("aapka khaata seal ho jayega aur recovery notice ghar pe aayega", "C", "hinglish", "scam"),
    ("main bank ke security cell se hoon aapke account se paisa nikalne ki koshish hui hai", "AC", "hinglish", "scam"),

    # ---------------- scam: urgency ---------------------------------------
    ("we only have a few moments left before the system locks you out permanently", "CU", "en", "scam"),
    ("please stay connected i cannot let you go until the formality is finished", "U", "en", "scam"),
    ("act at once there is no scope for waiting even a single minute", "U", "en", "scam"),
    ("abhi is waqt karna hoga warna procedure band ho jayega", "U", "hinglish", "scam"),
    ("phone kaan se mat hataiye main line pe hoon", "U", "hinglish", "scam"),

    # ---------------- scam: financial instruction -------------------------
    ("kindly remit the sum to the beneficiary details i am dictating to you now", "F", "en", "scam"),
    ("put the money into the escrow wallet and it will be reversed after clearance", "F", "en", "scam"),
    ("we need a token deposit before the hold on your funds can be lifted", "F", "en", "scam"),
    ("do the needful and push the balance to the account i shared on whatsapp", "F", "en", "scam"),
    ("aap paisa is beneficiary me daal dijiye jo main abhi bata raha hoon", "F", "hinglish", "scam"),

    # ---------------- scam: full-pressure composites ----------------------
    ("this is the reserve bank your account is compromised move forty eight thousand to the safe account right now", "ACUF", "en", "scam"),
    ("officer here a warrant is pending you must deposit the security amount within thirty minutes and do not inform anybody", "ACUFS", "en", "scam"),
    ("your kyc has lapsed the account closes tonight transfer the verification charge immediately", "CUF", "en", "scam"),
    ("customs has held your shipment pay the clearance amount at once or it goes for legal seizure", "ACUF", "en", "scam"),
    ("i am from the cyber cell this matter is confidential send the amount and do not speak to your family about it", "AFS", "en", "scam"),
    ("bank se bol raha hoon account block hone wala hai turant paisa transfer kijiye aur kisi ko mat bataiye", "ACUFS", "hinglish", "scam"),
    ("police case hai jaldi kijiye paisa bhejiye warna arrest ho jayega", "ACUF", "hinglish", "scam"),

    # ---------------- scam: secrecy ---------------------------------------
    ("you are not permitted to reveal the contents of this call to any third party", "S", "en", "scam"),
    ("keep this strictly between the two of us the department does not allow disclosure", "S", "en", "scam"),
    ("branch wale is case ke baare me kuch nahi jaante unse baat mat kijiye", "S", "hinglish", "scam"),

    # ---------------- scam: credential request ----------------------------
    ("dictate the numbers that just flashed on your screen so i can authenticate you", "R", "en", "scam"),
    ("i require the four digit secret you use at the atm to close this ticket", "R", "en", "scam"),
    ("kindly type the code into the app and also read it aloud to me", "R", "en", "scam"),
    ("get the support tool from the store and hand me the session number", "R", "en", "scam"),
    ("jo number abhi message me aaya hai wo bata dijiye taaki verify ho jaye", "R", "hinglish", "scam"),
    ("apna secret pin bataiye main yahin se process kar deta hoon", "R", "hinglish", "scam"),
    ("share the one time code and then transfer the amount to complete the reversal", "RF", "en", "scam"),

    # ---------------- SAFE: ordinary talk ---------------------------------
    ("shall we order something from outside tonight i am too tired to cook", "", "en", "safe"),
    ("the electrician came in the morning and fixed the geyser finally", "", "en", "safe"),
    ("i reached office late because the metro was shut at one station", "", "en", "safe"),
    ("kal mausam kharab tha isliye plan cancel kar diya", "", "hinglish", "safe"),
    ("did you get the parcel that was supposed to come yesterday", "", "en", "safe"),
    ("my laptop battery is finished i have to get it replaced soon", "", "en", "safe"),
    ("we are going to the temple in the morning so wake me up early", "", "en", "safe"),
    ("kitne baje nikal rahe ho office se aaj", "", "hinglish", "safe"),

    # ---------------- SAFE: money, but benign -----------------------------
    ("i will settle the amount for the tickets once you tell me the total", "F", "en", "safe"),
    ("put four hundred in my account whenever convenient no hurry at all", "F", "en", "safe"),
    ("the chemist bill came to three twenty i paid it already", "", "en", "safe"),
    ("i am sending the maid her salary today like every month", "F", "en", "safe"),
    ("transfer the tuition fee to the same school account we used last term", "F", "en", "safe"),
    ("mujhe do sau rupaye bhej dena jab time mile koi jaldi nahi hai", "F", "hinglish", "safe"),
    ("society maintenance ka paisa har mahine pehli tareekh ko jaata hai", "", "hinglish", "safe"),
    ("i pay the same amount to my landlord on the second of every month", "F", "en", "safe"),
    ("the vendor invoice was approved by finance so release the payment", "F", "en", "safe"),

    # ---------------- SAFE hard negatives: urgency without threat ---------
    ("please send it quickly my wallet is empty and i am at the counter", "UF", "en", "safe"),
    ("i need it fast the shop is about to close in ten minutes", "U", "en", "safe"),
    ("hurry up and book the tickets before the price goes up again", "U", "en", "safe"),
    ("jaldi bhej de yaar mera phone ka recharge khatam ho gaya hai", "UF", "hinglish", "safe"),
    ("the form has to be submitted today otherwise the seat will be given away", "U", "en", "safe"),

    # ---------------- SAFE hard negatives: authority, genuine -------------
    ("this is a service message from your bank your cheque book has been dispatched", "A", "en", "safe"),
    ("we are calling from the hospital billing counter to confirm your appointment", "A", "en", "safe"),
    ("your bank will never ask for the one time code please stay alert", "A", "en", "safe"),
    ("this is the insurance office your policy document is ready for collection", "A", "en", "safe"),
    ("customer care here your complaint has been resolved no action needed from you", "A", "en", "safe"),
    ("bank se service call hai aapka statement app me available hai", "A", "hinglish", "safe"),

    # ---------------- SAFE hard negatives: threat-shaped but benign -------
    ("if you do not water the plants they will dry out completely", "", "en", "safe"),
    ("my phone will die in five minutes so call me back on the landline", "U", "en", "safe"),
    ("the subscription will lapse at the end of the month if we do not renew", "", "en", "safe"),
    ("they said the offer closes tomorrow but i am not going to rush into it", "", "en", "safe"),

    # ---------------- SAFE hard negatives: secrecy, benign ----------------
    ("do not say anything to her the party is meant to be a surprise", "S", "en", "safe"),
    ("keep the salary figure to yourself i do not want it discussed at work", "S", "en", "safe"),
    ("kisi ko mat batana main uske liye gift laa raha hoon", "S", "hinglish", "safe"),

    # ---------------- SAFE hard negatives: credential words, benign -------
    ("i never tell anyone my pin not even the people at the bank", "R", "en", "safe"),
    ("the app asked me for a code and i typed it in myself", "R", "en", "safe"),
    ("remember that no genuine caller will ever ask you for the otp", "R", "en", "safe"),

    # ---------------- edge cases: short and ambiguous windows -------------
    ("hello hello can you hear me", "", "en", "safe"),
    ("yes sir tell me", "", "en", "safe"),
    ("haan ji boliye", "", "hinglish", "safe"),
    ("one moment please", "", "en", "safe"),
    ("okay okay i understand", "", "en", "safe"),
    ("the amount is forty eight thousand", "", "en", "safe"),
    ("account number please", "", "en", "safe"),
    # ---------------- additional coverage: sparse labels ------------------
    ("the file cannot be closed unless the penalty amount is paid at once", "CUF", "en", "scam"),
    ("your provident fund account has been flagged and contributions will be stopped", "AC", "en", "scam"),
    ("if the verification fails today the entire balance gets forfeited to the treasury", "C", "en", "scam"),
    ("we will be forced to escalate this to the recovery agents visiting your residence", "C", "en", "scam"),
    ("aapka pf account hold pe daal diya gaya hai aur paisa nikal nahi payega", "AC", "hinglish", "scam"),
    ("non compliance will attract a penalty and your salary account gets attached", "C", "en", "scam"),
    ("this conversation is under the official secrets provision you cannot record or repeat it", "AS", "en", "scam"),
    ("you are instructed not to consult anyone including a lawyer until we finish", "S", "en", "scam"),
    ("do not step out of the room and do not let anyone else hear this call", "SU", "en", "scam"),
    ("apne bhai ya kisi rishtedaar ko is baare me bilkul mat batana", "S", "hinglish", "scam"),
    ("the matter is sealed by the court so discussing it outside is punishable", "AS", "en", "scam"),
    ("i will need the numbers printed on the reverse side of the card to proceed", "R", "en", "scam"),
    ("forward me the message that just arrived without opening the link yourself", "R", "en", "scam"),
    ("enter the passcode when i tell you and keep the screen shared with me", "R", "en", "scam"),
    ("aadhaar ka number aur uske saath jo code aaya hai dono bataiye", "R", "hinglish", "scam"),
    ("give me remote control of the handset so i can complete the settings", "R", "en", "scam"),
    # more benign hard negatives
    ("nobody should ever be given the code that comes on your phone", "R", "en", "safe"),
    ("my father keeps his pin written in a diary which i keep telling him not to do", "R", "en", "safe"),
    ("please do not repeat what i told you about the promotion till it is official", "S", "en", "safe"),
    ("we are keeping the news quiet until the doctor confirms it", "S", "en", "safe"),
    ("the landlord will hold the flat only if we pay the deposit this week", "CUF", "en", "safe"),
    ("if we miss the deadline the visa application gets rejected outright", "C", "en", "safe"),
    ("the gym membership will be cancelled if the dues are not cleared", "C", "en", "safe"),
    ("courier guy called and said he will return the parcel if nobody is home", "C", "en", "safe"),
    ("send me the rent amount i will forward it to the owner in the evening", "F", "en", "safe"),
]


def main() -> int:
    out = Path(__file__).resolve().parent / "test_holdout.jsonl"
    seen = set()
    rows = []
    for i, (text, codes, lang, kind) in enumerate(EXAMPLES):
        if text in seen:
            raise SystemExit(f"duplicate holdout text: {text!r}")
        seen.add(text)
        for c in codes:
            if c not in CODE:
                raise SystemExit(f"unknown label code {c!r} in {text!r}")
        rows.append({
            "id": f"holdout-{i:04d}",
            "text": text,
            "labels": {lab: int(lab in {CODE[c] for c in codes}) for lab in LABELS},
            "families": ["hand-authored"],
            "lang": lang,
            "kind": kind,
            "n_utterances": 1,
            "source": "hand-authored",
            "split": "holdout",
        })
    with out.open("w", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    pos = {lab: sum(r["labels"][lab] for r in rows) for lab in LABELS}
    print(f"wrote {len(rows)} hand-authored rows -> {out}")
    print("positives per label:", pos)
    print("all-zero rows:", sum(1 for r in rows if not any(r["labels"].values())))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
