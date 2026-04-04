export default function Footer() {
  return (
    <div className="footer">
      {/* VIOLATION: no footer landmark (should be <footer>) */}

      <div className="footer-links">
        {/* VIOLATION: list of links in divs instead of nav > ul > li */}
        <div className="link-group">
          <h5>Company</h5>
          <div><a href="/about">About Us</a></div>
          <div><a href="/careers">Careers</a></div>
          <div><a href="/press">Press</a></div>
        </div>

        <div className="link-group">
          <h6>Support</h6>
          <div><a href="/help">Help Center</a></div>
          <div><a href="/returns">Returns</a></div>
          {/* VIOLATION: link with no text content */}
          <div aria-label="Order status"><a href="/status"><span className="status-dot"></span></a></div>
        </div>

        <div className="link-group">
          <h6>Legal</h6>
          <div><a href="/privacy">Privacy Policy</a></div>
          <div><a href="/terms">Terms of Service</a></div>
          {/* VIOLATION: aria-labelledby references ID that doesn't exist */}
          <div>
            <a href="/accessibility">Accessibility</a>
          </div>
        </div>
      </div>

      <div className="footer-bottom">
        <p>&copy; 2026 Example Store. All rights reserved.</p>

        {/* VIOLATION: social icons with no accessible names */}
        <div className="social-icons">
          <a href="https://facebook.com" target="_blank" aria-label="Facebook">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z" /></svg>
          </a>
          <a href="https://instagram.com" target="_blank" aria-label="Instagram">
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="5" ry="5" /><path d="M16 11.37A4 4 0 1112.63 8 4 4 0 0116 11.37z" /><line x1="17.5" y1="6.5" x2="17.51" y2="6.5" /></svg>
          </a>
          <a href="https://twitter.com" target="_blank" aria-label="Twitter">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M23 3a10.9 10.9 0 01-3.14 1.53 4.48 4.48 0 00-7.86 3v1A10.66 10.66 0 013 4s-4 9 5 13a11.64 11.64 0 01-7 2c9 5 20 0 20-11.5a4.5 4.5 0 00-.08-.83A7.72 7.72 0 0023 3z" /></svg>
          </a>
        </div>

        {/* VIOLATION: duplicate ID */}
        <div id="footer-note">Made with care</div>
        <div id="footer-note">Shipped worldwide</div>
      </div>
    </div>
  );
}
