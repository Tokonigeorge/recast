const products = [
  { id: 1, name: "Wireless Headphones", price: 79.99, img: "/headphones.jpg" },
  { id: 2, name: "USB-C Hub", price: 49.99, img: "/hub.jpg" },
  { id: 3, name: "Mechanical Keyboard", price: 129.99, img: "/keyboard.jpg" },
  { id: 4, name: "Monitor Stand", price: 39.99, img: "/stand.jpg" },
];

function ProductCard({ product }) {
  return (
    // VIOLATION: entire card is a clickable div, no role, no keyboard
    <div
      className="product-card"
      onClick={() => window.location.href = `/product/${product.id}`}
    >
      {/* VIOLATION: product image has no alt text */}
      <img src={product.img} className="product-image" />

      {/* VIOLATION: heading level skip — h5 inside a section with no h2/h3/h4 */}
      <h5 className="product-name">{product.name}</h5>

      <span className="product-price">${product.price.toFixed(2)}</span>

      {/* VIOLATION: button inside implicit form context, no type */}
      <button className="add-to-cart">Add to Cart</button>

      {/* VIOLATION: icon button with no accessible name */}
      <button className="wishlist-btn" onClick={(e) => { e.stopPropagation(); }}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
        </svg>
      </button>
    </div>
  );
}

export default function ProductGrid() {
  return (
    <div className="product-grid">
      {/* VIOLATION: no section heading, no landmark role */}
      <h3>Featured Products</h3>

      {/* VIOLATION: list semantics — products in divs, not ul/li */}
      <div className="grid">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </div>
  );
}
