import type { ReactNode } from "react";
import { Nav } from "./Nav";
import { Footer } from "./Sections";

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <Nav />
      <main className="section">
        <article className="container legal">
          <h1 style={{ fontSize: "2.4rem" }}>{title}</h1>
          <div className="notice">
            <strong>Draft template.</strong> This text is a placeholder written for WillSpot and has not been reviewed by a lawyer. It must be
            replaced with counsel-approved terms before launch (see docs/BENNYBIT_ANALYSIS.md §6).
          </div>
          {children}
        </article>
      </main>
      <Footer />
    </>
  );
}
