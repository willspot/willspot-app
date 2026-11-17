import { Hero } from "@/components/Hero";
import { Nav } from "@/components/Nav";
import { Cta, Faq, Features, Footer, HowItWorks, Rates } from "@/components/Sections";

export default function Home() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Rates />
        <Features />
        <HowItWorks />
        <Faq />
        <Cta />
      </main>
      <Footer />
    </>
  );
}
