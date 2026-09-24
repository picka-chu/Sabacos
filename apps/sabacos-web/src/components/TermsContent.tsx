import { useI18n } from "../i18n.js";

interface TermsSection {
  title: string;
  body: string[];
}

const SECTIONS: TermsSection[] = [
  {
    title: "1. About Sabacos",
    body: [
      "Sabacos (\"we\", \"us\") operates an online cosmetics and beauty store serving customers in Ethiopia, accessible through our Telegram bot, mini app, and web storefront. By placing an order or using our services, you agree to these Terms.",
      "Contact: +251930529985 · Addis Ababa, Ethiopia",
    ],
  },
  {
    title: "2. Products, Pricing & Availability",
    body: [
      "All prices are in Ethiopian Birr (ETB) and include applicable taxes unless stated otherwise.",
      "Product images are illustrative; slight variations in packaging or shade may occur. Descriptions are provided in English and Amharic — in case of conflict, the English version prevails.",
      "Products are subject to availability. If an item becomes unavailable after you order, we will notify you and offer a substitute, store credit, or refund.",
      "We reserve the right to correct pricing errors. If an obvious error is discovered after payment, we will contact you to confirm or cancel with a full refund.",
    ],
  },
  {
    title: "3. Orders",
    body: [
      "An order is confirmed only after successful payment or payment verification. Orders with pending/failed payment are automatically cancelled.",
      "Minimum order value is 100 ETB; orders below it cannot be checked out.",
      "You must provide an accurate name, phone number, and delivery address. We are not liable for failed deliveries caused by incorrect details.",
      "Order status progresses: confirmed → processing → shipped → delivered. You can track status in the app under Orders.",
    ],
  },
  {
    title: "4. Payments",
    body: [
      "Full payment via Chapa (Telegram): pay the total instantly through our secure Telegram invoice.",
      "Split payment (50/50): pay 50% deposit now — either via Chapa or bank transfer — and the remaining 50% in cash on delivery.",
      "Bank-transfer deposits require uploading a payment receipt; your order is confirmed only after our team verifies it (usually within 3–5 hours). Uploading a fake or altered receipt leads to immediate order cancellation and account suspension.",
      "Wallet balance: referral earnings and credits may be used toward purchases where offered.",
      "Phone-number matching (anti-fraud): the phone number used for Chapa payment must match the verified phone number on your account. Mismatched payments may be held or refunded.",
    ],
  },
  {
    title: "5. Delivery",
    body: [
      "Delivery fees depend on your zone and order value; delivery is free on orders above 8,000 ETB. Express delivery and fragile-item handling carry surcharges shown at checkout.",
      "Delivery takes 1–3 days within Addis Ababa. We currently do not deliver outside Addis Ababa. Estimates are not guarantees; delays from traffic, weather, or holidays do not entitle you to compensation.",
      "On delivery you must: inspect the package, pay any remaining cash balance (split orders), and confirm receipt. Refusal to pay the balance entitles the courier to return the goods, and the deposit is forfeited to cover costs.",
      "Risk of loss transfers to you upon delivery confirmation.",
    ],
  },
  {
    title: "6. Cancellations, Returns & Refunds",
    body: [
      "You may cancel before the order ships for a full refund of amounts paid.",
      "After shipment, cancellation is at our discretion and may deduct delivery costs already incurred.",
      "Eligible returns (within 3 days of delivery): unopened, unused items in original sealed packaging. For hygiene reasons, opened cosmetics cannot be returned unless damaged or incorrect.",
      "Damaged/wrong items: report with photos within 48 hours of delivery for replacement or refund.",
      "Approved refunds are issued to the original payment method (Chapa reversal, bank transfer, or wallet credit) within 7–14 business days.",
      "If a referred order is refunded or cancelled, any referral commission earned on it is reversed.",
    ],
  },
  {
    title: "7. Wallet",
    body: [
      "Wallet credit is in-app only and non-withdrawable — it cannot be converted to cash or transferred out.",
      "Referral commission becomes spendable only after the referred order is delivered plus a 4-day hold (to cover the return window). Amounts under review are locked until cleared.",
      "Wallet credit has no expiry unless stated in a specific promotion.",
    ],
  },
  {
    title: "8. Referral Program",
    body: [
      "Share your personal referral link. When a referred friend places their first qualifying order (minimum 300 ETB): you earn 10% of the order total as wallet credit, and your friend gets 5% off that first order automatically.",
      "Commission is subject to a rolling 30-day earning cap; amounts approaching the cap may be flagged for manual review before becoming spendable.",
      "Self-referrals, fake accounts, and coordinated abuse (shared devices, duplicate payment details, clustered fake orders) lead to forfeiture of rewards and permanent account suspension.",
      "Every 3 qualified referrals earns you 1 prize spin (max 5 per week); spins and coupons expire as shown in the app.",
      "We may modify or suspend the program with reasonable notice; earned, released credit is always honored.",
    ],
  },
  {
    title: "9. Promotions, Discounts & Coupons",
    body: [
      "Only one automatic discount applies per order (promotion, referral, or early-bird — whichever is applicable); they never stack. Spinner coupons, where valid, apply on top subject to their minimum-order and expiry terms.",
      "Coupons are single-use, non-transferable, and cannot be exchanged for cash.",
      "We may cancel promotions or void coupons obtained through abuse or technical error.",
    ],
  },
  {
    title: "10. Accounts & Acceptable Use",
    body: [
      "One account per person. You are responsible for activity under your Telegram account.",
      "Prohibited: fraud, fake receipts, chargeback abuse, scraping, interfering with the service, or reselling app content.",
      "We may suspend or terminate accounts that violate these Terms, with forfeiture of unreleased rewards.",
    ],
  },
  {
    title: "11. Privacy",
    body: [
      "We collect: Telegram ID and profile details, name, phone, delivery address, GPS location (only when you share it), order history, payment receipts, and support messages.",
      "We use this data to process orders, verify payments, calculate delivery, operate rewards, and prevent fraud. We never sell your data.",
      "Payment card/bank details are processed by our payment providers (e.g. Chapa); we do not store full card numbers.",
      "You may request correction or deletion of your data via +251930529985, subject to legal record-keeping duties.",
    ],
  },
  {
    title: "12. Referral Cash Payouts",
    body: [
      "In addition to spending commission in the app, you may withdraw it as cash to your bank account. Each commission becomes withdrawable 7 days after it is earned, provided it has not been reversed or flagged for review.",
      "Payouts run once a week, on the weekday your account was created, and only when your withdrawable balance reaches at least 500 ETB. Smaller balances carry over to the following week — nothing is forfeited.",
      "To receive payouts you must save a valid bank account in the app (Referrals → Wallet). Transfers are sent through our payment provider; a payout may fail (for example outside banking hours), in which case the amount is returned to your wallet automatically.",
      "When a payout is created, the amount is immediately deducted from your wallet so it cannot be spent twice. If the transfer fails, it is refunded to your wallet.",
      "If commission included in an already-sent payout is later reversed (for example the underlying order is refunded), the cash cannot be clawed back; the payout is flagged and your account may be reviewed before future payouts.",
    ],
  },
  {
    title: "13. Limitation of Liability",
    body: [
      "Products are for personal use; perform a patch test before full use. We are not liable for allergic reactions where ingredients were disclosed.",
      "To the maximum extent permitted by law, our total liability for any order is limited to the amount you paid for that order. We are not liable for indirect or consequential losses.",
    ],
  },
  {
    title: "14. Changes & Governing Law",
    body: [
      "We may update these Terms; material changes will be announced in the app/channel, and continued use constitutes acceptance.",
      "These Terms are governed by the laws of the Federal Democratic Republic of Ethiopia. Disputes will first be addressed through good-faith negotiation via +251930529985.",
    ],
  },
];

/** The full legal text, rendered in both the onboarding gate and the /terms route. */
export function TermsContent() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {SECTIONS.map((s) => (
        <section key={s.title}>
          <h3 className="serif" style={{ fontSize: 16, margin: "0 0 8px", fontWeight: 700 }}>
            {s.title}
          </h3>
          {s.body.map((p, i) => (
            <p key={i} style={{ margin: "0 0 8px", fontSize: 14, lineHeight: 1.65, color: "var(--text-secondary, inherit)" }}>
              {p}
            </p>
          ))}
        </section>
      ))}
    </div>
  );
}
