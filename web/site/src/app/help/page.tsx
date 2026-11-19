import { HelpCentre } from "@/components/HelpCentre";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Sections";

export const metadata = { title: "Help centre", description: "Answers about accounts, deposits, withdrawals, crypto, gift cards, bills and security." };

export default function Help() {
  return (
    <>
      <Nav />
      <HelpCentre />
      <Footer />
    </>
  );
}
