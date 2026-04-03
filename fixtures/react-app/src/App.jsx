import Header from "./components/Header.jsx";
import Hero from "./components/Hero.jsx";
import ProductGrid from "./components/ProductGrid.jsx";
import ContactForm from "./components/ContactForm.jsx";
import Footer from "./components/Footer.jsx";
import "./styles.css";

export default function App() {
  return (
    <>
      <Header />
      <Hero />
      <ProductGrid />
      <ContactForm />
      <Footer />
    </>
  );
}
