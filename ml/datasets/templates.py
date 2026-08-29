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

    # --- widened authority surface forms (v2) ------------------------- #
    # The v1 set was narrow and almost always put the authority claim in
    # sentence-initial position ("I am calling from X."). Against a 64-token
    # window that taught position as much as content. These families vary the
    # institution AND where in the sentence the claim lands.
    F("auth_branch_manager", ("authority",), "en", (
        "I am the branch manager at {bank}, {name} speaking.",
        "Speaking from the {bank} branch, I handle escalations here.",
        "My name is {name} and I head the verification desk at {bank}.",
        "You are speaking with the {bank} nodal officer, employee code {emp}.",
    )),
    F("auth_trailing_claim", ("authority",), "en", (
        "Your account has been flagged, this is {agency} calling.",
        "There is a case registered against you, I am from {agency}.",
        "A notice has been issued, {agency} is handling the matter.",
        "The file is with us now, {bank} security department.",
    )),
    F("auth_cyber_cell", ("authority",), "en", (
        "I am an inspector with the cyber cell, badge number {emp}.",
        "This call is from the cybercrime investigation unit.",
        "The cyber cell has taken cognisance of activity on your number.",
    )),
    F("auth_kyc_aadhaar", ("authority",), "en", (
        "I am calling from the KYC compliance team at {bank}.",
        "This is the Aadhaar update helpdesk, official line.",
        "We are the authorised KYC verification agency for {bank}.",
        "Your Aadhaar linking is pending, I am from the verification cell.",
    )),
    F("auth_insurance", ("authority",), "en", (
        "I am from the insurance regulatory grievance cell.",
        "This is {name} from the policy verification department.",
        "Calling from the claims authority regarding your lapsed policy.",
    )),
    F("auth_rbi", ("authority",), "en", (
        "I am an officer of the Reserve Bank of India, banking ombudsman wing.",
        "This is an RBI authorised communication regarding your account.",
        "The Reserve Bank has directed us to contact you directly.",
    )),
    F("auth_courier_customs_wide", ("authority",), "en", (
        "Customs department here, a parcel in your name has been detained.",
        "I am the customs clearance officer handling your {courier} shipment.",
        "This is {courier} in coordination with the customs authority.",
    )),
    F("auth_mixed_hinglish", ("authority",), "hinglish", (
        "Main {bank} ke head office se bol raha hoon, {name} naam hai mera.",
        "Aapke account pe case hai, main {agency} se hoon.",
        "Cyber cell se baat kar rahe hain hum, samajh rahe hain aap?",
        "Main branch manager hoon {bank} ka, employee ID {emp}.",
        "KYC verification department se call kar rahi hoon main.",
    )),
    F("auth_trai_telecom_wide", ("authority",), "hinglish", (
        "TRAI se bol raha hoon, aapka number band hone wala hai.",
        "Telecom regulatory authority ki taraf se ye official call hai.",
        "Main department of telecommunications se hoon sir.",
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

    # --- widened urgency surface forms (v2) --------------------------- #
    # Urgency was the weakest NEURAL label in v1 (test F1 0.18) and had the
    # second-fewest families. The v1 phrasings clustered on "immediately" and
    # "do not disconnect"; these add deadlines, consequences-of-delay, and
    # trailing time pressure so the label is not carried by two keywords.
    F("urg_deadline_named", ("urgency",), "en", (
        "The cut-off is {hours} from now, after that the system locks.",
        "You have until the end of {hours} and not a minute longer.",
        "The deadline expires in {minutes} minutes, I am watching the clock.",
        "Processing stops at midnight tonight, there is no extension.",
    )),
    F("urg_consequence_of_delay", ("urgency",), "en", (
        "Every minute you wait makes this harder to reverse.",
        "If we delay further the amount doubles, that is the rule.",
        "Once the window passes I cannot help you at all.",
        "Waiting even a few minutes will escalate this automatically.",
    )),
    F("urg_trailing_pressure", ("urgency",), "en", (
        "Please open the app, quickly, we are running out of time.",
        "Do it now itself, do not wait for tomorrow.",
        "Complete the step while I am still on the line, immediately.",
        "Finish it fast, I cannot hold this much longer.",
    )),
    F("urg_hinglish_wide", ("urgency",), "hinglish", (
        "Sirf {minutes} minute bacha hai, uske baad system band ho jayega.",
        "Der karenge to problem badh jayegi, abhi kar lijiye.",
        "Turant kariye sir, main line pe wait kar raha hoon.",
        "Aaj raat tak ka time hai, kal kuch nahi hoga.",
        "Jitni der karenge utna mushkil hoga, jaldi.",
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

    # --- widened secrecy surface forms (v2) --------------------------- #
    # Secrecy had the fewest families (5) and became the weakest label once
    # urgency was fixed. v1 leaned on "do not tell" and "confidential"; these
    # add isolation framing, plausible cover stories, and trailing placement.
    F("sec_isolation", ("secrecy",), "en", (
        "Step into another room where nobody can hear you.",
        "Are you alone right now? Make sure no one is listening.",
        "Go somewhere private before we continue with this.",
        "If someone asks, tell them it is a routine call, nothing more.",
    )),
    F("sec_cover_story", ("secrecy",), "en", (
        "If the bank calls, say you made the transfer yourself.",
        "Tell them at home it is a normal payment, do not explain further.",
        "Do not show this message to anyone, delete it after we finish.",
    )),
    F("sec_trailing", ("secrecy",), "en", (
        "Complete the transfer, and keep this between us only.",
        "Finish the process, nobody else needs to know about it.",
        "Do the verification quietly, without involving your family.",
    )),
    F("sec_hinglish_wide", ("secrecy",), "hinglish", (
        "Kisi ko mat batana, ye humare beech ki baat hai.",
        "Akele hain aap? Koi sun to nahi raha?",
        "Ghar walon ko mat bataiye, warna case aur bigad jayega.",
        "Doosre room me jaiye, phir baat karte hain.",
        "Agar koi puche to keh dena normal call thi.",
    )),
    F("sec_authority_gag", ("secrecy",), "en", (
        "Under the official secrets provision you cannot disclose this call.",
        "Informing a third party will be treated as obstruction of the case.",
        "Legal instructions prohibit you from sharing this with relatives.",
    )),

    # --- secrecy: everyday concealment, not just legal framing (v3) ---- #
    # v2 secrecy still leaned on institutional language ("confidential
    # investigation", "official secrets"). Real concealment pressure is
    # usually plainer than that, which is why the label kept underperforming
    # on the authored holdout.
    F("sec_plain_conceal", ("secrecy",), "en", (
        "Let us keep this between the two of us for now.",
        "There is no need to involve anyone else in this.",
        "Better if nobody else knows what we discussed today.",
        "Handle it yourself, do not loop in anyone.",
    )),
    F("sec_delete_traces", ("secrecy",), "en", (
        "Clear the call log once we are finished here.",
        "Delete these messages after you have read them.",
        "Do not keep a record of this conversation anywhere.",
    )),
    F("sec_hinglish_plain", ("secrecy",), "hinglish", (
        "Apne aap tak rakhiye ye baat, kisi aur ko involve mat kariye.",
        "Baaki logon ko batane ki koi zaroorat nahi hai.",
        "Message padh ke delete kar dena.",
        "Ye humare beech hi rahega, theek hai na?",
    )),

    # ------------------------------------------------------------------ #
    # GROOMING -- isolation of a child from trusted adults.
    #
    # This is the SAME secrecy tactic a scammer uses to keep a victim off the
    # phone to their bank, so it scores on the existing `secrecy` label. No
    # seventh label, no contract change. The lexicon already covers these
    # patterns (mobile/src/risk/classifier/lexicon.ts); this gives the neural
    # model the coverage it did not have.
    # ------------------------------------------------------------------ #
    F("groom_secret", ("secrecy",), "en", (
        "This is our little secret, okay?",
        "Do not tell your mum or dad about our chats.",
        "If your parents ask, just say we talk about games.",
        "Promise me you will not show this to your teacher.",
    )),
    F("groom_isolate", ("secrecy",), "en", (
        "Are you home alone right now?",
        "Message me when nobody is around you.",
        "Is anyone else looking at your screen?",
        "Wait until your parents are asleep, then reply.",
    )),
    F("groom_platform_move", ("secrecy",), "en", (
        "Let us move this chat to Telegram, it is more private.",
        "Add me on Snapchat instead, the messages disappear there.",
        "Delete the chat history once you have replied.",
    )),
    F("groom_hinglish", ("secrecy",), "hinglish", (
        "Ye apna secret hai, kisi ko mat batana.",
        "Mummy papa ko mat dikhana ye chat.",
        "Akele ho abhi? Koi aas paas to nahi hai?",
        "Chat delete kar dena baad me.",
    )),

    # ------------------------------------------------------------------ #
    # SEXTORTION -- threat to publish intimate images.
    #
    # Different content from an account-freeze threat, identical coercion
    # structure: comply or you lose something you cannot get back. Scores on
    # `coercion`, and usually co-occurs with secrecy and urgency.
    # ------------------------------------------------------------------ #
    F("sext_threat_publish", ("coercion",), "en", (
        "I have screenshots and I will send them to your friends.",
        "Do as I say or these pictures go to your whole contact list.",
        "I will post the video on your school group if you ignore me.",
        "Your parents will see everything unless you cooperate.",
    )),
    F("sext_reputation", ("coercion",), "en", (
        "I can ruin your reputation in one minute, think about it.",
        "Everyone at your college will know by tomorrow morning.",
        "Your life will be finished once this goes out.",
    )),
    F("sext_hinglish", ("coercion",), "hinglish", (
        "Tumhare saare dosto ko bhej dunga ye photos.",
        "Ghar walo ko dikha dunga, phir dekhna kya hota hai.",
        "Teri izzat barbaad kar dunga agar tune mana kiya.",
        "School group me daal dunga video, samjhe?",
    )),

    # ------------------------------------------------------------------ #
    # SAFEGUARDING / AWARENESS COPY -- the false-positive trap.
    #
    # This text uses the exact vocabulary of the abuse it warns about. An
    # anti-sextortion poster says "if someone threatens to share your photos".
    # Without these as explicit negatives the model learns the vocabulary
    # rather than the intent, and a helpline advert scores as an attack.
    # Labelled all-zero on purpose.
    # ------------------------------------------------------------------ #
    F("safe_awareness_sextortion", (), "en", (
        "If someone threatens to share your photos, report it and tell a trusted adult.",
        "No one has the right to blackmail you with pictures. Help is available.",
        "Sharing intimate images without consent is a crime. You can report it.",
        "If you are being blackmailed online, contact the cyber tipline immediately.",
    ), "safe"),
    F("safe_awareness_grooming", (), "en", (
        "If an adult asks you to keep a secret from your parents, tell someone you trust.",
        "A safe adult will never ask you to delete your chats.",
        "Talk to a teacher or a parent if someone online makes you uncomfortable.",
        "Childline is free and confidential if you need to talk to someone.",
    ), "safe"),
    F("safe_awareness_hinglish", (), "hinglish", (
        "Agar koi aapko photos ke naam pe dhamka raha hai, turant report kijiye.",
        "Kisi bhi ajnabi ko apni personal photos mat bhejiye.",
        "Bacchon ko sikhaiye ki secret rakhne ko kaha jaye to bade ko batayein.",
    ), "safe"),

    # ------------------------------------------------------------------ #
    # BENIGN USES OF SECRECY VOCABULARY -- hard negatives.
    #
    # Adding grooming families pushed `secrecy` to the most prevalent label in
    # the training set, and the model started firing on the *words* rather
    # than the intent: on the authored holdout secrecy recall hit 1.00 with
    # precision 0.28. "Don't tell mum, it's a surprise" is not concealment
    # pressure, and neither is deleting photos to free up storage.
    #
    # These carry the vocabulary with none of the intent, and are labelled
    # all-zero so the model has to learn the difference.
    # ------------------------------------------------------------------ #
    F("safe_surprise_secret", (), "en", (
        "Do not tell papa, the cake is meant to be a surprise.",
        "Keep it secret until the party, she has no idea yet.",
        "Shh, do not mention the gift in front of her.",
        "It is a surprise for mummy, so no telling anyone at home.",
    ), "safe"),
    F("safe_ordinary_privacy", (), "en", (
        "This is a private family matter, we will discuss it at home.",
        "I would rather not talk about my salary with the whole office.",
        "Let us keep the discussion in this group only, it gets confusing otherwise.",
        "Between us, I think the new manager is doing a good job.",
    ), "safe"),
    F("safe_delete_mundane", (), "en", (
        "Delete those old screenshots, the phone storage is full.",
        "Clear the chat, it has three hundred forwards in it.",
        "I deleted the messages by mistake, can you send them again?",
    ), "safe"),
    F("safe_alone_mundane", (), "en", (
        "Are you home? I am outside with the parcel.",
        "Are you alone or is the whole family there for dinner?",
        "I am home alone today, come over if you are free.",
    ), "safe"),
    F("safe_secret_hinglish", (), "hinglish", (
        "Mummy ko mat batana, surprise hai unke liye.",
        "Ye baat abhi kisi ko mat bolna, plan final nahi hua hai.",
        "Chat delete kar diya galti se, dobara bhej do.",
        "Ghar pe akele ho? Main aa raha hoon.",
    ), "safe"),

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

    # ------------------------------------------------------------------ #
    # HARD NEGATIVES: urgency vocabulary, no urgency
    #
    # Why these exist: on the authored holdout, urgency ran at precision 0.281
    # with 41 false positives against 16 true ones — it had learned that any
    # time word means pressure. The label is specifically *time pressure applied
    # to the listener to act*. A speaker who is themselves in a hurry, a stated
    # fact about when something happens, or a rush that already ended are all
    # label 0, and none of that was represented in training.
    # ------------------------------------------------------------------ #
    F("hardneg_speaker_own_hurry", (), "en", (
        "I am running late for the office, I will call you back.",
        "Sorry, I have to rush, the train leaves in {minutes} minutes.",
        "I am in a hurry right now, can we talk in the evening?",
        "Give me {minutes} minutes, I am just finishing lunch.",
        "I am late already, {relation} has been waiting since morning.",
    ), kind="safe"),
    F("hardneg_schedule_facts", (), "en", (
        "The delivery slot is between two and four this afternoon.",
        "The movie starts at seven, we can leave whenever you are ready.",
        "The shop closes at nine, no rush, it is only {hours} away.",
        "My appointment with the doctor is at four thirty tomorrow.",
        "The {courier} package is showing out for delivery today.",
        "The match is on at eight, I will be home before that.",
    ), kind="safe"),
    F("hardneg_rush_already_over", (), "en", (
        "We finished the report just in time yesterday, it was very close.",
        "There was a big rush at the {merchant} counter but we managed.",
        "I had to hurry last night, thankfully everything worked out.",
        "It was urgent last week, now it is all sorted.",
    ), kind="safe"),
    F("hardneg_urgency_hinglish", (), "hinglish", (
        "Yaar main late ho gaya hoon, thodi der mein call karta hoon.",
        "Abhi jaldi mein hoon, shaam ko baat karte hain.",
        "Train {minutes} minute mein hai, main nikal raha hoon.",
        "Bas do minute, main aa raha hoon.",
        "Kal bahut jaldi thi, ab sab theek hai.",
    ), kind="safe"),

    # ------------------------------------------------------------------ #
    # HARD NEGATIVES: money vocabulary, no instruction to move money
    #
    # financialInstruction is an instruction to the *listener* to move money.
    # Naming a price, reporting a payment the speaker already made, or asking
    # what something cost are none of those. Holdout precision was 0.550.
    # ------------------------------------------------------------------ #
    F("hardneg_money_mentioned", (), "en", (
        "The scooter repair cost me {small} rupees at the garage.",
        "That phone is around {large} now, the price went up.",
        "We spent about {small} on groceries at {merchant} this month.",
        "The ticket was {small} each, which is cheaper than last year.",
        "Electricity bill came to {small} this time, higher than usual.",
    ), kind="safe"),
    F("hardneg_payment_completed", (), "en", (
        "I already paid the electricity bill yesterday, it is done.",
        "The transfer went through last night, {relation} confirmed it.",
        "I have settled the {merchant} bill, nothing is pending.",
        "The EMI was auto debited this morning as usual.",
        "Salary got credited today, a day earlier than expected.",
    ), kind="safe"),
    F("hardneg_price_question", (), "en", (
        "How much did the repair come to in the end?",
        "What is the going rate for that these days?",
        "Was it expensive, or did you get a discount?",
        "Do you remember how much we paid at {merchant} last time?",
    ), kind="safe"),
    F("hardneg_money_hinglish", (), "hinglish", (
        "Bill already pay kar diya maine kal hi.",
        "Yeh wala {small} ka aata hai, market mein.",
        "Salary aa gayi hai aaj, time pe.",
        "Kitne ka mila tujhe? Mehenga tha kya?",
        "Maine {merchant} ka payment kar diya tha pichle hafte.",
    ), kind="safe"),

    # ------------------------------------------------------------------ #
    # WIDER financialInstruction SURFACE FORMS
    #
    # Holdout recall was 0.440: the model knew "transfer X to account Y" and
    # little else. These are the same instruction in the phrasings people
    # actually use, so the label is learned as intent rather than as a verb.
    # ------------------------------------------------------------------ #
    F("fin_wide_phrasings", ("financialInstruction",), "en", (
        "Just put the {large} through to this account and we are done.",
        "Go ahead and move the money across now.",
        "Send it to the number I messaged you, {large} should cover it.",
        "You will need to do a bank transfer of {large} today.",
        "Push {large} to the {wallet} number I am about to give you.",
        "Once you make the payment of {large}, everything will be cleared.",
        "Kindly do the needful and remit {large} to the given account.",
    )),
    F("fin_wide_hinglish", ("financialInstruction",), "hinglish", (
        "Aap {large} is account mein daal dijiye abhi.",
        "Paise transfer kar do is number pe, {large}.",
        "{wallet} se bhej dijiye {large}, main number deta hoon.",
        "Bas payment kar dijiye {large} ka, phir sab clear ho jayega.",
    )),
]
