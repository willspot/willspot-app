import { LegalPage } from "@/components/LegalPage";

export const metadata = { title: "Privacy policy" };

export default function Privacy() {
  return (
    <LegalPage title="Privacy policy">
      <h2>What we collect</h2>
      <p>Your name, email, phone number, date of birth, the last four digits of your BVN and ID number (we keep a one-way hash, not the full number), your transactions, and basic device information.</p>
      <h2>Why</h2>
      <p>To verify your identity as Nigerian law requires, to run your account, to prevent fraud and to meet our reporting obligations.</p>
      <h2>Who we share it with</h2>
      <p>Only identity-verification, banking and liquidity partners that process transactions for you, and authorities where the law requires. We list our partners in the app. We do not sell your data.</p>
      <h2>Where it is stored</h2>
      <p>On servers in Nigeria where available, encrypted in transit and at rest.</p>
      <h2>Your rights</h2>
      <p>Under the Nigeria Data Protection Act 2023 you can ask for a copy of your data, correct it, or delete your account. Some records must be kept for a period set by law.</p>
    </LegalPage>
  );
}
