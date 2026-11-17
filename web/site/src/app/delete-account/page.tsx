import { LegalPage } from "@/components/LegalPage";
import bundled from "../../brand.json";

export const metadata = { title: "Delete your account" };

/**
 * App stores require a web page explaining deletion. We deliberately do NOT
 * collect passwords or PINs on the website; deletion happens inside the app
 * (with PIN confirmation) or by emailing support from the registered address.
 */
export default function DeleteAccount() {
  return (
    <LegalPage title="Delete your account">
      <h2>In the app</h2>
      <p>Open the app → Profile → Close account, then confirm with your PIN. You are signed out on every device straight away.</p>
      <h2>By email</h2>
      <p>
        Email <a href={`mailto:${bundled.support.email}?subject=Account%20deletion`}>{bundled.support.email}</a> from the address on your account. We
        will never ask for your password or PIN.
      </p>
      <h2>What happens to your data</h2>
      <p>Your profile is closed immediately. Transaction and identity records that the law requires us to keep are retained for that period and then deleted.</p>
    </LegalPage>
  );
}
