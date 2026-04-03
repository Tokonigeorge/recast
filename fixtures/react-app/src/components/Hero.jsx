export default function Hero() {
  return (
    <div className="hero">
      {/* VIOLATION: heading jumps from none to h3 (no h1 or h2 on page) */}
      <h3 className="hero-title">Welcome to Our Store</h3>

      {/* VIOLATION: decorative image missing alt="" */}
      <img src="/hero-bg.jpg" className="hero-bg" role="presentation" />

      <p className="hero-subtitle">
        The best products at the best prices.
      </p>

      {/* VIOLATION: div styled as button, has onClick but no role, no keyboard */}
      <div
        className="cta-button"
        onClick={() => window.location.href = "/products"}
        style={{
          padding: "12px 24px",
          backgroundColor: "#007bff",
          color: "white",
          borderRadius: "6px",
          cursor: "pointer",
          display: "inline-block",
        }}
      >
        Shop Now
      </div>

      {/* VIOLATION: autoplay video with no captions track */}
      <video autoPlay muted loop className="hero-video">
        <source src="/promo.mp4" type="video/mp4" />
      </video>
    </div>
  );
}
