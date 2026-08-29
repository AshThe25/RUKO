"""Slot fillers for the Ruko synthetic conversation generator.

India-first vocabulary. Nothing here is scraped from real conversations; every
value is either a public institution name, a common given name, or an invented
identifier.
"""

BANKS = [
    "State Bank of India", "SBI", "HDFC Bank", "ICICI Bank", "Axis Bank",
    "Punjab National Bank", "Kotak Mahindra Bank", "Bank of Baroda",
    "Canara Bank", "Union Bank", "IndusInd Bank", "Yes Bank",
]

AGENCIES = [
    "the Cyber Crime Branch", "the CBI", "the Narcotics Control Bureau",
    "the Income Tax Department", "TRAI", "the Enforcement Directorate",
    "the Delhi Police Crime Branch", "the Mumbai Police", "Customs",
    "the Reserve Bank of India",
]

WALLETS = ["Paytm", "PhonePe", "Google Pay", "BHIM", "Amazon Pay"]

COURIERS = ["FedEx", "BlueDart", "DTDC", "DHL", "India Post"]

FIRST_NAMES = [
    "Rahul", "Amit", "Priya", "Sunil", "Vikas", "Anita", "Rajesh", "Neha",
    "Manoj", "Kavita", "Deepak", "Sneha", "Arjun", "Pooja", "Sanjay", "Ritu",
    "Karthik", "Meera", "Vivek", "Divya", "Ravi", "Anjali",
]

RELATIONS = [
    "my brother", "my sister", "mummy", "papa", "my roommate", "my colleague",
    "my friend", "bhaiya", "didi",
]

MERCHANTS = [
    "Big Bazaar", "the kirana store", "Swiggy", "Zomato", "Amazon", "Flipkart",
    "the medical store", "the petrol pump", "Blinkit",
]

EMP_IDS = ["4471", "88203", "SB-2291", "EMP7734", "1129", "CB-4408"]

SMALL_AMOUNTS = ["200", "300", "450", "500", "650", "800", "1,200", "1,500", "2,000"]
LARGE_AMOUNTS = ["18,000", "25,000", "32,000", "45,000", "48,000", "62,000",
                 "75,000", "1,20,000", "2,50,000"]
RENT_AMOUNTS = ["12,000", "18,000", "22,000", "35,000", "50,000"]

MINUTES = ["5", "10", "15", "20", "30"]
HOURS = ["one hour", "two hours", "24 hours", "48 hours"]

ACCOUNT_TAIL = ["3421", "7789", "0056", "9012", "4467"]
UPI_IDS = ["verify@okaxis", "secure.rbi@ybl", "refund9021@paytm",
           "safeaccount@oksbi", "clearance44@upi"]

REMOTE_APPS = ["AnyDesk", "TeamViewer", "QuickSupport", "RustDesk"]
