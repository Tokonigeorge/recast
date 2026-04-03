import { useState } from "react";

export default function ContactForm() {
  const [formData, setFormData] = useState({ name: "", email: "", message: "" });
  const [errors, setErrors] = useState({});

  const handleSubmit = (e) => {
    e.preventDefault();
    const newErrors = {};
    if (!formData.name) newErrors.name = "Name is required";
    if (!formData.email) newErrors.email = "Email is required";
    setErrors(newErrors);
  };

  return (
    <div className="contact-section">
      {/* VIOLATION: heading hierarchy — h4 after h3, skipping context */}
      <h4>Get In Touch</h4>

      <form onSubmit={handleSubmit}>
        {/* VIOLATION: input with no associated label */}
        <input
          type="text"
          placeholder="Your name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
        />
        {/* VIOLATION: error message not associated with input, no aria-describedby, no role="alert" */}
        {errors.name && <span className="error" style={{ color: "red" }}>{errors.name}</span>}

        {/* VIOLATION: input with no label */}
        <input
          type="email"
          placeholder="Your email"
          value={formData.email}
          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
        />
        {errors.email && <span className="error" style={{ color: "red" }}>{errors.email}</span>}

        {/* VIOLATION: textarea with no label */}
        <textarea
          placeholder="Your message"
          rows={5}
          value={formData.message}
          onChange={(e) => setFormData({ ...formData, message: e.target.value })}
        />

        {/* VIOLATION: button in form with no type attribute */}
        <button>Send Message</button>

        {/* VIOLATION: div styled as button for "clear" action */}
        <div
          className="clear-btn"
          onClick={() => setFormData({ name: "", email: "", message: "" })}
          style={{ cursor: "pointer", textDecoration: "underline", color: "#666" }}
        >
          Clear form
        </div>
      </form>

      {/* VIOLATION: decorative separator image */}
      <img src="data:image/svg+xml,<svg/>" className="divider" />
    </div>
  );
}
