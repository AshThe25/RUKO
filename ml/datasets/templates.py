"""Template families for the Ruko manipulation-signal dataset.

A *family* is one conversational archetype (e.g. "caller claims to be from a
bank", "friend asks to split dinner"). Each family carries the manipulation
tactics its utterances express.

WHY FAMILIES MATTER: the train/val/test split is disjoint **by family**, not by
row. If we split rows randomly, the test set would contain slot-variants of
training rows and the reported F1 would be meaningless. Families are the unit of
generalisation we are actually testing.

LABEL SEMANTICS (see also docs/contracts/conversation.schema.ts):
  authority           the speaker asserts institutional authority over the
                      listener. This is an authority *claim* -- no model can
                      verify identity from speech, so a genuine bank call is
                      labelled the same way. It only becomes risk when the risk
                      engine fuses it with coercion / a payment instruction.
  coercion            threat of loss: freeze, arrest, disconnection, legal case.
  urgency             time pressure, "right now", "do not disconnect".
  financialInstruction an instruction to the listener to move money.
  secrecy             instruction to conceal the interaction from others.
  credentialRequest   asking for OTP / PIN / CVV / card number, or for remote
                      access to the device (which is a credential in effect).
"""

from dataclasses import dataclass, field

LABELS = [
    "authority",
    "coercion",
    "urgency",
    "financialInstruction",
    "secrecy",
    "credentialRequest",
]


@dataclass(frozen=True)
class Family:
    id: str
    tactics: tuple  # subset of LABELS
    lang: str  # 'en' | 'hinglish'
    templates: tuple
    # 'scam' families are drawn from manipulative calls; 'safe' from ordinary
    # conversation. This is metadata only -- it is never a training label.
    kind: str = "scam"
    # Families that must never be composed together (would read as nonsense).
    solo: bool = False


F = Family

FAMILIES: list = [
    # ------------------------------------------------------------------ #
    # AUTHORITY CLAIM
    # ------------------------------------------------------------------ #
    F("auth_bank_intro", ("authority",), "en", (
        "Hello sir, I am calling from {bank} head office.",
        "Good morning, this is {name} from the {bank} fraud prevention department.",
        "Sir, I am a senior officer at {bank}, my employee ID is {emp}.",
        "Madam, this call is from the {bank} customer verification cell.",
        "I am speaking from the head branch of {bank}, account security division.",
    )),
    F("auth_police", ("authority",), "en", (
        "Sir, this is inspector {name} from {agency}.",
        "This call is being recorded, I am an officer from {agency}.",
        "We are from {agency} and your name has come up in an investigation.",
        "I am the investigating officer assigned to your case from {agency}.",
    )),
    F("auth_regulator", ("authority",), "en", (
        "This is an official communication from {agency}.",
        "I am calling on behalf of {agency}, department of compliance.",
        "Sir, {agency} has issued a notice against your PAN number.",
    )),
    F("auth_courier_customs", ("authority",), "en", (
        "Sir, I am calling from {courier} international shipping.",
        "This is the customs clearance department, a parcel in your name has been stopped.",
        "I am from {courier} logistics, we have flagged a consignment linked to your Aadhaar.",
    )),
    F("auth_bank_hinglish", ("authority",), "hinglish", (
        "Hello sir, main {bank} head office se bol raha hoon.",
        "Namaste ji, main {name} bol rahi hoon {bank} ke fraud department se.",
        "Sir main {bank} ka senior officer hoon, mera employee ID {emp} hai.",
    )),
    F("auth_police_hinglish", ("authority",), "hinglish", (
        "Sir main {agency} se inspector {name} bol raha hoon.",
        "Ye call {agency} se hai, aapke naam pe ek case register hua hai.",
        "Main {agency} ka officer hoon, dhyan se suniye.",
    )),
    F("auth_telecom", ("authority",), "en", (
        "I am calling from the telecom regulatory authority regarding your number.",
        "This is the mobile number verification department, sir.",
    )),
    F("auth_electricity", ("authority",), "en", (
        "I am from the electricity board billing section.",
        "This is the power distribution company, official communication.",
    )),

    # ------------------------------------------------------------------ #
    # COERCION -- threat of loss
    # ------------------------------------------------------------------ #
    F("coerce_freeze", ("coercion",), "en", (
        "Your account will be frozen if this is not resolved.",
        "We will have to suspend all banking services on your account today.",
        "Your account ending {tail} is going to be blocked permanently.",
        "If you disconnect now, your account will be locked and you will lose access.",
    )),
    F("coerce_arrest", ("coercion",), "en", (
        "A non bailable warrant has been issued in your name.",
        "If you do not cooperate, the police will come to your address tonight.",
        "You will be arrested and your family will be questioned.",
        "This is a money laundering case, you can be taken into custody.",
    )),
    F("coerce_sim_block", ("coercion",), "en", (
        "Your SIM card will be deactivated within two hours.",
        "Your mobile number will be permanently disconnected by the department.",
    )),
    F("coerce_legal", ("coercion",), "en", (
        "A legal case will be filed against you in court.",
        "You will receive a summons and your salary account will be attached.",
        "The department will seize your assets if the amount is not cleared.",
    )),
    F("coerce_parcel", ("coercion",), "en", (
        "Illegal items were found in the parcel and it is a criminal offence.",
        "Your Aadhaar has been used in a narcotics case, this is very serious.",
    )),
    F("coerce_electricity", ("coercion",), "en", (
        "Your electricity connection will be disconnected tonight at 9 pm.",
        "Power supply to your house will be cut if the bill is not cleared now.",
    )),
    F("coerce_freeze_hinglish", ("coercion",), "hinglish", (
        "Aapka account block ho jayega agar abhi verify nahi kiya.",
        "Sir aapka account freeze kar diya jayega, phir kuch nahi ho payega.",
        "Aapki banking services band ho jayengi aaj hi.",
    )),
    F("coerce_arrest_hinglish", ("coercion",), "hinglish", (
        "Aapke naam pe warrant nikla hai, police aa jayegi.",
        "Ye money laundering ka case hai, aap arrest ho sakte hain.",
        "Agar cooperate nahi kiya to legal action hoga aapke against.",
    )),

    # ------------------------------------------------------------------ #
    # URGENCY
    # ------------------------------------------------------------------ #
    F("urg_immediate", ("urgency",), "en", (
        "You have to do this immediately, right now.",
        "There is no time, this must be completed in the next {minutes} minutes.",
        "Sir please hurry, the window closes in {minutes} minutes.",
        "This has to be done before {hours}, after that nothing can be done.",
    )),
    F("urg_dont_disconnect", ("urgency",), "en", (
        "Do not disconnect this call under any circumstances.",
        "Stay on the line with me, do not cut the call.",
        "Keep me on the phone while you do it, do not hang up.",
        "Do not put me on hold, I have to stay connected until it is done.",
    )),
    F("urg_last_chance", ("urgency",), "en", (
        "This is the final reminder, no further notice will be sent.",
        "Today is the last date, after that the case goes to the next stage.",
    )),
    F("urg_hinglish", ("urgency",), "hinglish", (
        "Sir abhi ke abhi karna padega, time nahi hai.",
        "Jaldi kijiye, sirf {minutes} minute hain aapke paas.",
        "Call mat kaatiye, line pe rahiye mere saath.",
        "Aaj last date hai, uske baad kuch nahi ho payega.",
    )),

    # ------------------------------------------------------------------ #
    # FINANCIAL INSTRUCTION
    # ------------------------------------------------------------------ #
    F("fin_transfer_account", ("financialInstruction",), "en", (
        "Transfer {large} rupees to the account number I am giving you.",
        "You need to send {large} to this account for verification.",
        "Please make a payment of {large} rupees to account ending {tail}.",
    )),
    F("fin_upi", ("financialInstruction",), "en", (
        "Send the amount to this UPI ID, {upi}.",
        "Open your {wallet} app and pay {large} to {upi}.",
        "Just scan the QR code I am sending and pay {large} rupees.",
    )),
    F("fin_safe_account", ("financialInstruction",), "en", (
        "Move your balance to the government safe account for protection.",
        "For your own safety we will hold the {large} in a secure RBI account.",
        "Deposit {large} into the verification account and it will be returned in 24 hours.",
    )),
    F("fin_refund_reverse", ("financialInstruction",), "en", (
        "The refund of {large} was sent twice by mistake, please return the extra amount.",
        "You have received {large} extra, transfer it back to this account immediately.",
    )),
    F("fin_fees", ("financialInstruction",), "en", (
        "A processing fee of {large} rupees has to be paid to release the amount.",
        "Pay the clearance charges of {large} and the parcel will be delivered.",
        "There is a GST charge of {large} on the prize money, pay it first.",
    )),
    F("fin_investment", ("financialInstruction",), "en", (
        "Invest {large} today and you will get double returns within a week.",
        "Deposit {large} in the trading account, our expert will handle it.",
    )),
    F("fin_hinglish", ("financialInstruction",), "hinglish", (
        "Sir {large} rupaye is account me transfer kar dijiye.",
        "{wallet} kholiye aur {upi} pe {large} bhej dijiye.",
        "QR code scan karke {large} ka payment kar dijiye abhi.",
        "Verification ke liye {large} deposit karna padega.",
    )),

    # ------------------------------------------------------------------ #
    # SECRECY
    # ------------------------------------------------------------------ #
    F("sec_dont_tell", ("secrecy",), "en", (
        "Do not discuss this with anyone in your family.",
        "This is a confidential matter, do not tell your wife or your son.",
        "Please do not mention this call to anybody.",
    )),
    F("sec_confidential_case", ("secrecy",), "en", (
        "This is a confidential investigation, sharing details is an offence.",
        "You are under a digital arrest order, you cannot inform anyone.",
    )),
    F("sec_no_branch", ("secrecy",), "en", (
        "Do not go to the bank branch, they are not authorised for this case.",
        "Do not call the customer care number, the case is with our department only.",
    )),
    F("sec_hinglish", ("secrecy",), "hinglish", (
        "Ye baat kisi ko mat bataiye, ghar me bhi nahi.",
        "Confidential matter hai, family ko batana mana hai.",
        "Bank branch mat jaiye, wo log is case ko handle nahi karte.",
    )),

    # ------------------------------------------------------------------ #
    # CREDENTIAL REQUEST
    # ------------------------------------------------------------------ #
    F("cred_otp", ("credentialRequest",), "en", (
        "Tell me the OTP you have just received on your phone.",
        "Read out the six digit code from the message.",
        "Share the verification code with me to complete the process.",
    )),
    F("cred_pin_cvv", ("credentialRequest",), "en", (
        "I need your ATM PIN to verify the account.",
        "Please tell me the CVV number written behind your card.",
        "Give me your UPI PIN so I can complete the reversal from my side.",
    )),
    F("cred_card_number", ("credentialRequest",), "en", (
        "Read out the sixteen digit number on your debit card.",
        "Confirm your card number and expiry date for verification.",
    )),
    F("cred_remote_access", ("credentialRequest",), "en", (
        "Install {remote} from the play store so I can see your screen.",
        "Download {remote} and give me the nine digit code it shows.",
        "Share your screen with me so I can guide you through the settings.",
    )),
    F("cred_hinglish", ("credentialRequest",), "hinglish", (
        "OTP bataiye jo abhi aapke phone pe aaya hai.",
        "Apna UPI PIN bata dijiye, main yahan se complete kar dunga.",
        "{remote} install kijiye aur code bataiye.",
        "Card ke peeche jo CVV likha hai wo bataiye.",
    )),
    F("cred_kyc", ("credentialRequest",), "en", (
        "Send me a photo of your Aadhaar card and PAN card on WhatsApp.",
        "Your KYC is pending, share your Aadhaar number for updating.",
    )),

    # ------------------------------------------------------------------ #
    # SAFE -- ordinary conversation. All labels zero unless noted.
    # ------------------------------------------------------------------ #
    F("safe_friend_split", (), "en", (
        "Hey, can you send me {small} for dinner last night?",
        "Split the cab fare with me, it was {small} in total.",
        "You owe me {small} from the movie tickets, send whenever.",
        "I paid for the pizza, transfer me {small} when you get time.",
    ), kind="safe"),
    F("safe_family", (), "en", (
        "{relation} needs {small} for groceries, I will send it.",
        "Send {small} to mummy for the medicines please.",
        "Papa asked me to transfer {small} for the electricity bill.",
    ), kind="safe"),
    F("safe_merchant", (), "en", (
        "I am paying {small} at {merchant} right now.",
        "The bill at {merchant} came to {small} rupees.",
        "Just paid {small} for the groceries.",
    ), kind="safe"),
    F("safe_bank_info", ("authority",), "en", (
        "This is {bank} customer care, your current balance is {small} rupees.",
        "Your {bank} statement for this month is ready in the app.",
        "This is a service call from {bank}, your card has been delivered.",
        "{bank} here, we are calling to confirm your new address on record.",
    ), kind="safe"),
    F("safe_support_no_payment", ("authority",), "en", (
        "I am from {wallet} support, I can see your transaction failed and it will auto refund.",
        "This is customer support, please do not share any OTP with anyone including us.",
        "{bank} will never ask you for your PIN or OTP on a call.",
    ), kind="safe"),
    F("safe_chat", (), "en", (
        "Are we still meeting at six in the evening?",
        "The traffic was terrible today, took me an hour.",
        "Did you watch the match last night, what a finish.",
        "I will be a little late, starting from office now.",
    ), kind="safe"),
    F("safe_shopping", (), "en", (
        "The phone I wanted is on sale on {merchant} this week.",
        "I am thinking of ordering from {merchant} tonight.",
    ), kind="safe"),
    F("safe_hinglish_friend", (), "hinglish", (
        "Yaar {small} bhej de, kal wapas kar dunga.",
        "Dinner ka {small} hua tha, apna share bhej dena.",
        "Cab ka {small} split kar lete hain.",
    ), kind="safe"),
    F("safe_hinglish_family", (), "hinglish", (
        "Mummy ko {small} bhej dena dawai ke liye.",
        "Papa ne bola tha {small} transfer kar dena bill ka.",
    ), kind="safe"),
    F("safe_emi", (), "en", (
        "My EMI of {small} gets deducted on the fifth of every month.",
        "The loan instalment went through yesterday, {small} rupees.",
    ), kind="safe"),
    F("safe_salary", (), "en", (
        "Salary got credited today, finally.",
        "The reimbursement of {small} came through from office.",
    ), kind="safe"),

    # -- HARD NEGATIVES: safe conversations that contain a real tactic ---- #
    # These exist so the model does not learn "any money talk == scam", and so
    # the risk engine gets honest signals it can fuse with payment context.
    F("hard_urgent_friend", ("urgency", "financialInstruction"), "en", (
        "Bro I need {small} urgently right now, my card is not working.",
        "Please send {small} immediately, I am stuck at the hospital counter.",
        "Send {small} fast, the cab driver is waiting and I have no cash.",
    ), kind="safe"),
    F("hard_urgent_friend_hinglish", ("urgency", "financialInstruction"), "hinglish", (
        "Yaar urgent hai, {small} abhi bhej de please.",
        "Jaldi {small} transfer kar de, mera card block ho gaya hai.",
    ), kind="safe"),
    F("hard_rent_landlord", ("financialInstruction",), "en", (
        "I am transferring the rent of {rent} to the landlord today.",
        "Rent is due, sending {rent} to the same account as every month.",
        "Landlord asked for the {rent} rent before the fifth.",
    ), kind="safe"),
    F("hard_legit_bank_verify", ("authority", "coercion"), "en", (
        "This is {bank}, we noticed an unusual login and have temporarily locked your card for safety.",
        "{bank} security here, your card is blocked as a precaution, please visit the branch.",
    ), kind="safe"),
    F("hard_legit_deadline", ("urgency",), "en", (
        "The last date to file the return is the thirty first, do not forget.",
        "Please submit the documents before Friday or the application will lapse.",
    ), kind="safe"),
    F("hard_business_payment", ("financialInstruction",), "en", (
        "Please release the vendor payment of {large} today, the invoice is approved.",
        "Transfer {large} to the supplier account as agreed in the contract.",
    ), kind="safe"),
    F("hard_surprise_secret", ("secrecy",), "en", (
        "Do not tell {relation}, it is a surprise for the birthday.",
        "Keep it between us, I want the gift to be a surprise.",
    ), kind="safe"),
    F("hard_otp_warning", ("credentialRequest",), "en", (
        "Never share your OTP with anyone, not even with bank staff.",
        "My friend lost money because he shared the OTP on a call.",
    ), kind="safe"),
]
