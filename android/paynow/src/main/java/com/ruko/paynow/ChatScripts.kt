package com.ruko.paynow

/**
 * The two conversations the demo plays back.
 *
 * These are written to match the shape of real reported scams rather than to
 * match Ruko's detectors — the wording is drawn from the pressure tactics that
 * show up in actual UPI fraud and grooming transcripts. If a line here fails to
 * trip the detector, that is a finding about the detector, not a reason to
 * reword the line.
 */
object ChatScripts {

    data class Line(
        val text: String,
        val incoming: Boolean,
        /** Delay before this line appears, once playback starts. */
        val afterMs: Long,
    )

    data class Script(
        val id: String,
        val sender: String,
        val initials: String,
        val preview: String,
        val lines: List<Line>,
    )

    /** Bank-impersonation into a UPI transfer. The classic Indian scam. */
    private val kyc = Script(
        id = "kyc",
        sender = "KYC Verification Desk",
        initials = "KV",
        preview = "Your account will be blocked today",
        lines = listOf(
            Line("Dear customer, your bank account KYC has expired.", true, 1200),
            Line("Your account will be blocked within 2 hours if KYC is not completed.", true, 3200),
            Line("who is this?", false, 5200),
            Line("We are calling from the bank verification department. This is urgent.", true, 7000),
            Line("To keep your account active, complete KYC by sending a refundable verification payment of ₹500 to kyc.verify9931@ybl", true, 9500),
            Line("Please share the OTP you receive to confirm your identity.", true, 12000),
            Line("Do not discuss this with anyone, it is a confidential security process.", true, 14500),
        ),
    )

    /** Grooming into sextortion. The payment is the last step, not the first. */
    private val grooming = Script(
        id = "grooming",
        sender = "Rohit (Instagram)",
        initials = "RI",
        preview = "don't tell your parents ok",
        lines = listOf(
            Line("hey! saw your story, you seem really mature for your age", true, 1200),
            Line("thanks lol", false, 3000),
            Line("you're different from other people i talk to. i feel like i can trust you", true, 4800),
            Line("don't tell your parents about me ok, they won't understand us", true, 7200),
            Line("i still have the photos you sent. i don't want to share them", true, 9800),
            Line("just send ₹2000 to rohit.9x@paytm right now and i'll delete everything immediately", true, 12400),
            Line("you have 30 minutes. don't tell anyone or i post them", true, 15000),
        ),
    )

    /**
     * A child topping up a game, repeatedly.
     *
     * No individual payment here is suspicious and no message is threatening —
     * which is the point. This scenario is not caught by language at all; it is
     * caught by the cumulative-spend rule noticing six ₹500 transfers to the
     * same merchant inside an hour. It exists in the demo to show that Ruko is
     * not just a keyword matcher.
     */
    private val gameTopUp = Script(
        id = "game",
        sender = "Diamond Store (Free Fire)",
        initials = "DS",
        preview = "Top-up successful! Buy more?",
        lines = listOf(
            Line("Top-up successful! 520 diamonds added ✨", true, 1000),
            Line("FLASH SALE ending soon — 2x diamonds on every ₹500 top-up", true, 2600),
            Line("one more", false, 4200),
            Line("Great! Send ₹500 to diamondstore@ybl to claim 2x bonus", true, 5600),
            Line("Only 3 bonus packs left at this price!", true, 7600),
        ),
    )

    val all = listOf(kyc, grooming, gameTopUp)

    fun byId(id: String?): Script = all.firstOrNull { it.id == id } ?: kyc
}
