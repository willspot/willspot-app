import { LegalPage } from "@/components/LegalPage";

export const metadata = { title: "Terms of service" };

export default function Terms() {
  return (
    <LegalPage title="Terms of service">
      <h2>1. Who can use the service</h2>
      <p>You must be 18 or older, resident in Nigeria, and able to complete identity verification.</p>
      <h2>2. What we provide</h2>
      <p>A Naira wallet, bank deposits and withdrawals, and the purchase and sale of selected digital assets, each provided through licensed partners named in the app once agreements are in place.</p>
      <h2>3. Fees</h2>
      <p>Every fee is shown before you confirm a transaction. Crypto prices include our margin.</p>
      <h2>4. Your responsibilities</h2>
      <p>Keep your password and PIN private. Use the service lawfully and only with funds that belong to you.</p>
      <h2>5. Holds and reviews</h2>
      <p>We may delay, review or refuse a transaction when the law requires it or to protect you from fraud, and we will tell you when we can.</p>
      <h2>6. Governing law</h2>
      <p>These terms are governed by the laws of the Federal Republic of Nigeria.</p>
    </LegalPage>
  );
}
