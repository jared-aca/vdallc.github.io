import type { Metadata } from "next";
import Admin from "./ui";
import "./admin.css";
export const metadata: Metadata = {
  title: "Content Studio | VDA LLC",
  robots: { index: false, follow: false },
};
export default function AdminPage() {
  return <Admin />;
}
