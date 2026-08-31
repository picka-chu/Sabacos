import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Plus, Search, Package, Tag } from "lucide-react";
import { formatETB, type Category, type Product } from "@sabacos/core";
import { api } from "../lib/api.js";
import { useAuth } from "../auth.js";
import { SkeletonTable, EmptyState } from "../components/ui.js";

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
    const params = new URLSearchParams();
    if (search.trim()) params.set("q", search.trim());
    api
      .get<{ categories: Category[] }>("/admin/categories", token ?? undefined)
      .then((res) => setCategories(res.categories))
      .catch(() => {});
    api
      .get<ProductPageData>(`/admin/products?${params.toString()}`, token ?? undefined)
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
        <div
          className="row"
          style={{
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            background: "var(--surface)",
            padding: "0 12px",
            flex: 1,
            maxWidth: 360,
          }}
        >
          <Search size={16} className="muted" />
          <input
            className="input"
            style={{ border: "none", boxShadow: "none", padding: "9px 6px", background: "transparent" }}
            placeholder="Search name or SKU…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") load();
            }}
          />
        </div>
      </div>

      {error && (
        <div style={{ padding: "12px 16px", borderRadius: "var(--radius-sm)", background: "var(--danger-soft)", color: "var(--danger)", fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {!data ? (
          <SkeletonTable rows={6} cols={5} />
        ) : data.items.length === 0 ? (
          <EmptyState
            icon={<Package size={40} strokeWidth={1.25} />}
            title="No products found"
          >
            <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
              {search.trim() ? "Try a different search term." : "Create your first product to get started."}
            </p>
            {!search.trim() && (
              <button className="btn btn-primary btn-sm" style={{ marginTop: 8 }} onClick={() => navigate("/products/new")}>
                <Plus size={14} /> New product
              </button>
            )}
          </EmptyState>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table responsive-table">
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
                    <tr
                      key={product.id}
                      style={{ cursor: "pointer" }}
                      onClick={() => navigate(`/products/${product.id}`)}
                    >
                      <td data-label="">
                        {product.imageUrls[0] ? (
                          <img className="product-thumb" src={product.imageUrls[0]} alt={product.nameEn} />
                        ) : (
                          <div
                            className="product-thumb"
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              color: "var(--muted)",
                            }}
                          >
                            <Package size={18} />
                          </div>
                        )}
                      </td>
                      <td data-label="Product">
                        <div style={{ fontWeight: 600 }}>{product.nameEn}</div>
                        <div className="muted" style={{ fontSize: 12 }}>{product.sku}</div>
                      </td>
                      <td data-label="Category">
                        {category ? (
                          <span className="row" style={{ gap: 5 }}>
                            <Tag size={13} className="muted" />
                            {category.nameEn}
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td data-label="Price" style={{ fontWeight: 600 }}>
                        {formatETB(product.priceHalala)}
                      </td>
                      <td data-label="Stock">
                        <span className={`badge ${product.stock <= 5 ? "badge-danger" : ""}`}>
                          {product.stock}
                        </span>
                      </td>
                      <td data-label="Status">
                        <span className={`badge ${product.isActive ? "badge-success" : "badge-warn"}`}>
                          {product.isActive ? "Active" : "Hidden"}
                        </span>
                        {product.isFeatured && (
                          <span className="badge badge-info" style={{ marginLeft: 6 }}>Featured</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
