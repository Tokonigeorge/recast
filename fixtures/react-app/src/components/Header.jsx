import { useState } from "react";

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="header">
      {/* VIOLATION: div used as nav, no landmark role */}
      <div className="logo">
        {/* VIOLATION: image used as link but no alt text */}
        <a href="/">
          <img src="/logo.png" />
        </a>
      </div>

      {/* VIOLATION: div with onClick, no keyboard handler, no role */}
      <div
        className="hamburger"
        onClick={() => setMenuOpen(!menuOpen)}
      >
        <span className="bar"></span>
        <span className="bar"></span>
        <span className="bar"></span>
      </div>

      {/* VIOLATION: no nav landmark, links have no visible focus indicator (CSS) */}
      <div className={`nav-links ${menuOpen ? "open" : ""}`}>
        <a href="/products">Products</a>
        <a href="/about">About</a>
        <a href="/contact">Contact</a>

        {/* VIOLATION: empty link — icon-only, no accessible name */}
        <a href="/cart" className="cart-icon">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2z" />
          </svg>
        </a>

        {/* VIOLATION: link opens in new tab without warning */}
        <a href="https://twitter.com/example" target="_blank">Twitter</a>
      </div>
    </div>
  );
}
