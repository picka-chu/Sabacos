import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Plus, Search, Package, Tag } from "lucide-react";
import { formatETB, type Category, type Product } from "@sabacos/core";
import { api } from "../lib/api.js";
import { useAuth } from "../auth.js";

interface ProductPageData {
  items: Product[];
  total: number;
  page: number;
  pageSize: number;
}

export function ProductsPage() {
  const token = useAuth((s) => s.token);
  const [, navigate] = useLocation();
  const [data, setData] = useState<ProductPageData | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    if (!token) return;
    const params = new URLSearchParams();
    if (search.trim()) params.set("q", search.trim());
    api
      .get<{ categories: Category[] }>("/admin/categories", token)
      .then((res) => setCategories(res.categories))
      .catch(() => {});
    api
      .get<ProductPageData>(`/admin/products?${params.toString()}`, token)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load products"));
  };

  useEffect(load, [token]);

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Products</h1>
        <button className="btn btn-primary" onClick={() => navigate("/products/new")}>
          <Plus size={16} />
          New product
        </button>
      </div>

      <div className="row" style={{ marginBottom: 16 }}>
        <div className="row" style={{ border: "1px solid var(--border)", borderRadius: 9, background: "#fff", padding: "0 10px", flex: 1, maxWidth: 360 }}>
          <Search size={16} className="muted" />
          <input
            className="input"
            style={{ border: "none", boxShadow: "none", padding: "8px 6px" }}
            placeholder="Search name or SKU…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") load();
            }}
          />
        </div>
      </div>

      {error && <div className="card" style={{ color: "var(--danger)", marginBottom: 14 }}>{error}</div>}

      <div className="card" style={{ padding: 0 }}>
        {!data ? (
          <div className="empty">Loading…</div>
        ) : data.items.length === 0 ? (
          <div className="empty">
            <Package size={36} className="muted" style={{ marginBottom: 8 }} />
            <div>No products found</div>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th></th>
                <th>Product</th>
                <th>Category</th>
                <th>Price</th>
                <th>Stock</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((product) => {
                const category = categories.find((c) => c.id === product.categoryId);
                return (
                  <tr key={product.id} style={{ cursor: "pointer" }} onClick={() => navigate(`/products/${product.id}`)}>
                    <td>
                      {product.imageUrls[0] ? (
                        <img className="product-thumb" src={product.imageUrls[0]} alt={product.nameEn} />
                      ) : (
                        <div className="product-thumb" style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)" }}>
                          <Package size={18} />
                        </div>
                      )}
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{product.nameEn}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{product.sku}</div>
                    </td>
                    <td>
                      {category ? (
                        <span className="row" style={{ gap: 5 }}>
                          <Tag size={13} className="muted" />
                          {category.nameEn}
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>{formatETB(product.priceHalala)}</td>
                    <td>
                      <span className={`badge ${product.stock <= 5 ? "badge-danger" : ""}`}>{product.stock}</span>
                    </td>
                    <td>
                      <span className={`badge ${product.isActive ? "badge-success" : "badge-warn"}`}>
                        {product.isActive ? "Active" : "Hidden"}
                      </span>
                      {product.isFeatured && <span className="badge badge-info" style={{ marginLeft: 6 }}>Featured</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}