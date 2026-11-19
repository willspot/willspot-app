"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useBrand } from "@/lib/brand";

export function Logo() {
  const { brand } = useBrand();
  return (
    <Link href="/" className="logo" aria-label={`${brand.name} home`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={brand.logoMarkUrl} alt="" width={36} height={36} />
      <span>{brand.name}</span>
    </Link>
  );
}

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header className={`nav ${scrolled ? "scrolled" : ""}`}>
      <div className="container nav-inner">
        <Logo />
        <nav className="nav-links" aria-label="Main">
          <a href="/#features">Features</a>
          <a href="/#rates">Rates</a>
          <a href="/#how">How it works</a>
          <a href="/help">Help</a>
        </nav>
        <a className="btn btn-primary" href="/#download">
          Get the app
        </a>
      </div>
    </header>
  );
}
