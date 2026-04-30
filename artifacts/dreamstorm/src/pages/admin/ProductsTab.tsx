import { useState } from "react";
import {
  useListProducts,
  useCreateProduct,
  useUpdateProduct,
  useDeleteProduct,
  useListCategories,
} from "@workspace/api-client-react";
import type { Product as ApiProduct } from "@workspace/api-client-react";
import { uploadFile } from "@/lib/uploadFile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Category, type ProductSpec } from "@/data/products";
import { toStorageUrl } from "@/lib/storageUrl";
import { toast } from "sonner";
import { Loader2, Pencil, Plus, Trash2, Upload, X } from "lucide-react";

interface FormState {
  id: string;
  name: string;
  category: Category;
  price: string;
  imagePath: string;
  filePath: string | null;
  isBestSeller: boolean;
  isPublished: boolean;
  description: string;
  specifications: ProductSpec[];
}

const EMPTY_FORM: FormState = {
  id: "",
  name: "",
  // Initial value gets replaced with the first available category once the
  // /categories query resolves (see useEffect inside ProductsTab). We keep
  // "Streetwear" as a sensible default for the empty state since it is one
  // of the seven categories seeded on first server boot.
  category: "Streetwear",
  price: "",
  imagePath: "",
  filePath: null,
  isBestSeller: false,
  isPublished: true,
  description: "",
  specifications: [],
};

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function renderImage(path: string | null) {
  if (!path) return null;
  return <img src={toStorageUrl(path)} alt="" className="w-full h-full object-cover" />;
}

export function ProductsTab() {
  const { data: products, isLoading } = useListProducts<ApiProduct[]>();
  const createMut = useCreateProduct();
  const updateMut = useUpdateProduct();
  const deleteMut = useDeleteProduct();
  const { data: categories } = useListCategories();
  const categoryOptions: string[] = (categories ?? []).map((c) => c.name);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [imageUploading, setImageUploading] = useState(false);
  const [fileUploading, setFileUploading] = useState(false);

  const isEditing = editingId !== null;

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
  };

  const startEdit = (p: ApiProduct) => {
    setEditingId(p.id);
    setForm({
      id: p.id,
      name: p.name,
      category: p.category as Category,
      price: String(p.price),
      imagePath: p.imagePath,
      filePath: p.filePath,
      isBestSeller: p.isBestSeller,
      isPublished: p.isPublished,
      description: p.description ?? "",
      specifications: (p.specifications ?? []) as ProductSpec[],
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleImageUpload = async (file: File) => {
    setImageUploading(true);
    try {
      const path = await uploadFile(file);
      setForm((f) => ({ ...f, imagePath: path }));
      toast.success("Imagen subida");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al subir imagen");
    } finally {
      setImageUploading(false);
    }
  };

  const handleFileUpload = async (file: File) => {
    setFileUploading(true);
    try {
      const path = await uploadFile(file);
      setForm((f) => ({ ...f, filePath: path }));
      toast.success("Archivo PNG subido");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al subir archivo");
    } finally {
      setFileUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const priceNum = Number(form.price);
    if (!form.name.trim() || !form.imagePath || !Number.isFinite(priceNum) || priceNum < 0) {
      toast.error("Completá nombre, imagen y precio válido");
      return;
    }

    const cleanedSpecs = form.specifications
      .map((s) => ({ key: s.key.trim(), value: s.value.trim() }))
      .filter((s) => s.key.length > 0 && s.value.length > 0);
    const cleanedDescription = form.description.trim();

    try {
      if (isEditing && editingId) {
        await updateMut.mutateAsync({
          id: editingId,
          data: {
            name: form.name.trim(),
            category: form.category,
            price: priceNum,
            imagePath: form.imagePath,
            filePath: form.filePath,
            isBestSeller: form.isBestSeller,
            isPublished: form.isPublished,
            description: cleanedDescription.length > 0 ? cleanedDescription : null,
            specifications: cleanedSpecs,
          },
        });
        toast.success("Diseño actualizado");
      } else {
        const id = form.id.trim() || slugify(form.name);
        if (!id) {
          toast.error("ID inválido");
          return;
        }
        await createMut.mutateAsync({
          data: {
            id,
            name: form.name.trim(),
            category: form.category,
            price: priceNum,
            imagePath: form.imagePath,
            filePath: form.filePath ?? undefined,
            isBestSeller: form.isBestSeller,
            isPublished: form.isPublished,
            description: cleanedDescription.length > 0 ? cleanedDescription : undefined,
            specifications: cleanedSpecs.length > 0 ? cleanedSpecs : undefined,
          },
        });
        toast.success("Diseño creado");
      }
      resetForm();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al guardar");
    }
  };

  const handleDelete = async (p: ApiProduct) => {
    if (!confirm(`¿Eliminar "${p.name}"? Esta acción no se puede deshacer.`)) return;
    try {
      await deleteMut.mutateAsync({ id: p.id });
      toast.success("Diseño eliminado");
      if (editingId === p.id) resetForm();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al eliminar");
    }
  };

  return (
    <div className="grid lg:grid-cols-[400px_1fr] gap-8">
      <section>
        <div className="bg-card border border-card-border rounded-md p-6 lg:sticky lg:top-32">
          <h2 className="text-xl font-black uppercase tracking-tight mb-6 flex items-center gap-2">
            {isEditing ? <Pencil className="h-5 w-5 text-primary" /> : <Plus className="h-5 w-5 text-primary" />}
            {isEditing ? "Editar diseño" : "Nuevo diseño"}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nombre</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Urban Skull"
                required
              />
            </div>

            {!isEditing && (
              <div className="space-y-2">
                <Label htmlFor="id">ID (opcional)</Label>
                <Input
                  id="id"
                  value={form.id}
                  onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))}
                  placeholder="se genera automáticamente"
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="category">Categoría</Label>
              <Select
                value={form.category}
                onValueChange={(v) => setForm((f) => ({ ...f, category: v as Category }))}
              >
                <SelectTrigger id="category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {categoryOptions.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="price">Precio (ARS)</Label>
              <Input
                id="price"
                type="number"
                min={0}
                step="100"
                value={form.price}
                onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                placeholder="2500"
                required
              />
            </div>

            <div className="space-y-2">
              <Label>Imagen de vista previa</Label>
              <div className="border border-dashed border-white/15 rounded-sm p-3 space-y-3">
                {form.imagePath && (
                  <div className="aspect-square w-full bg-black/30 rounded-sm overflow-hidden">
                    {renderImage(form.imagePath)}
                  </div>
                )}
                <label className="flex items-center justify-center gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded-sm cursor-pointer hover:bg-white/10 text-sm font-medium">
                  {imageUploading ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Subiendo…</>
                  ) : (
                    <><Upload className="h-4 w-4" /> Subir imagen</>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={imageUploading}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleImageUpload(file);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Archivo PNG (descargable)</Label>
              <div className="border border-dashed border-white/15 rounded-sm p-3 space-y-3">
                {form.filePath && (
                  <p className="text-xs text-white/60 truncate">
                    {form.filePath}
                  </p>
                )}
                <label className="flex items-center justify-center gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded-sm cursor-pointer hover:bg-white/10 text-sm font-medium">
                  {fileUploading ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Subiendo…</>
                  ) : (
                    <><Upload className="h-4 w-4" /> {form.filePath ? "Reemplazar PNG" : "Subir PNG"}</>
                  )}
                  <input
                    type="file"
                    accept="image/png,application/zip"
                    className="hidden"
                    disabled={fileUploading}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileUpload(file);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Descripción (opcional)</Label>
              <Textarea
                id="description"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Diseño DTF de alta calidad, listo para estampar..."
                rows={3}
                maxLength={1000}
              />
              <p className="text-[10px] text-white/40 text-right">
                {form.description.length}/1000
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Especificaciones (opcional)</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      specifications: [...f.specifications, { key: "", value: "" }],
                    }))
                  }
                >
                  <Plus className="h-3 w-3 mr-1" /> Agregar
                </Button>
              </div>
              {form.specifications.length === 0 ? (
                <p className="text-[11px] text-white/40">
                  Ej: Tamaño · 30x40 cm, Tipo · DTF, Resolución · 300 dpi.
                </p>
              ) : (
                <div className="space-y-2">
                  {form.specifications.map((spec, idx) => (
                    <div key={idx} className="flex gap-2 items-start">
                      <Input
                        value={spec.key}
                        onChange={(e) => {
                          const v = e.target.value;
                          setForm((f) => ({
                            ...f,
                            specifications: f.specifications.map((s, i) =>
                              i === idx ? { ...s, key: v } : s,
                            ),
                          }));
                        }}
                        placeholder="Tamaño"
                        className="flex-1"
                        maxLength={40}
                      />
                      <Input
                        value={spec.value}
                        onChange={(e) => {
                          const v = e.target.value;
                          setForm((f) => ({
                            ...f,
                            specifications: f.specifications.map((s, i) =>
                              i === idx ? { ...s, value: v } : s,
                            ),
                          }));
                        }}
                        placeholder="30x40 cm"
                        className="flex-1"
                        maxLength={80}
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-9 w-9 shrink-0"
                        onClick={() =>
                          setForm((f) => ({
                            ...f,
                            specifications: f.specifications.filter((_, i) => i !== idx),
                          }))
                        }
                        aria-label="Quitar especificación"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-2">
              <Label htmlFor="bestseller" className="cursor-pointer">Más vendido</Label>
              <Switch
                id="bestseller"
                checked={form.isBestSeller}
                onCheckedChange={(v) => setForm((f) => ({ ...f, isBestSeller: v }))}
              />
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="published" className="cursor-pointer">Publicado</Label>
              <Switch
                id="published"
                checked={form.isPublished}
                onCheckedChange={(v) => setForm((f) => ({ ...f, isPublished: v }))}
              />
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                type="submit"
                className="flex-1 bg-primary hover:bg-primary/90"
                disabled={createMut.isPending || updateMut.isPending}
              >
                {(createMut.isPending || updateMut.isPending) && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                {isEditing ? "Guardar cambios" : "Crear diseño"}
              </Button>
              {isEditing && (
                <Button type="button" variant="outline" onClick={resetForm}>
                  Cancelar
                </Button>
              )}
            </div>
          </form>
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold uppercase tracking-wider">
            Diseños <span className="text-white/40">({products?.length ?? 0})</span>
          </h2>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-white/50" />
          </div>
        ) : !products || products.length === 0 ? (
          <div className="text-center py-24 border border-dashed border-white/10 rounded-sm">
            <p className="text-white/50">Todavía no hay diseños. Creá el primero a la izquierda.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {products.map((p) => (
              <article
                key={p.id}
                className="bg-card border border-card-border rounded-md overflow-hidden flex flex-col"
              >
                <div className="aspect-square bg-black/30 relative">
                  {renderImage(p.imagePath)}
                  {!p.isPublished && (
                    <span className="absolute top-2 left-2 text-[10px] font-bold uppercase tracking-widest bg-black/80 text-white/70 px-2 py-1 rounded-sm">
                      Borrador
                    </span>
                  )}
                  {p.isBestSeller && (
                    <span className="absolute top-2 right-2 text-[10px] font-bold uppercase tracking-widest bg-primary text-primary-foreground px-2 py-1 rounded-sm">
                      Top
                    </span>
                  )}
                </div>
                <div className="p-3 flex-1 flex flex-col gap-1">
                  <h3 className="font-bold text-sm leading-tight line-clamp-1">{p.name}</h3>
                  <p className="text-xs text-white/50 uppercase tracking-wider">{p.category}</p>
                  <p className="text-base font-black text-primary mt-1">
                    ${p.price.toLocaleString("es-AR")}
                  </p>
                  <div className="flex gap-2 mt-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => startEdit(p)}
                    >
                      <Pencil className="h-3 w-3 mr-1" /> Editar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDelete(p)}
                      disabled={deleteMut.isPending}
                      className="text-destructive-foreground hover:bg-destructive/20"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
