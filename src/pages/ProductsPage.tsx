import React, { useState, useMemo, useEffect } from 'react';
import SEO from '../components/SEO';
import ProductCard, { ProductCardSkeleton } from '../components/ProductCard';
import { Camera, Video } from 'lucide-react';
import EditableContent from '../components/EditableContent';
import { useProducts } from '../hooks/useProducts';
import { useData } from '../contexts/DataContext';
import { useLoading } from '../contexts/LoadingContext';

const ProductsPage: React.FC = () => {
  const { products, loading } = useProducts();
  const { getContent } = useData();
  const [activeCategory, setActiveCategory] = useState<'all' | 'video' | 'photo'>('all');
  const { setPageLoading } = useLoading();

  const productKey = products.map(p => `${p.id}:${p.array ?? 0}`).join(',');

  const productScores = useMemo(() => {
    if (products.length === 0) return new Map<number, number>();
    const map = new Map<number, number>();
    products.forEach(p => {
      const weight = Math.max(p.array ?? 1, 1);
      map.set(p.id, Math.random() ** (1 / weight));
    });
    return map;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productKey]);

  useEffect(() => {
    setPageLoading(loading);
  }, [loading, setPageLoading]);

  const filteredProducts = [...products]
    .filter(product => {
      if (activeCategory === 'all') return true;
      return product.category === activeCategory;
    })
    .sort((a, b) => {
      const scoreA = productScores.get(a.id) ?? 0;
      const scoreB = productScores.get(b.id) ?? 0;
      return scoreB - scoreA;
    });

  return (
    <div className="pt-20 pb-16">
      <SEO
        title={getContent('services-title', "Vores Tjenester")}
        description="Se alle vores dronepakker – luftfoto, dronefilmning og redigering. Bestil dronefotografering til ejendomme, events og erhverv i hele Danmark."
        canonical="/products"
      />
      <div className="bg-primary/10 py-12 mb-12">
        <div className="container">
          <EditableContent
            contentKey="services-title"
            as="h1"
            className="text-3xl md:text-4xl font-bold text-center mb-4"
            fallback="Vores Tjenester"
          />
          <EditableContent
            contentKey="services-subtitle"
            as="p"
            className="text-center text-lg text-neutral-300 max-w-2xl mx-auto"
            fallback="Udforsk vores udvalg af optagelser eller billeder og find den perfekte løsning til dit næste projekt."
          />
        </div>
      </div>
      <div className="container">
        <div className="flex justify-center mb-8 space-x-4">
          <button
            onClick={() => setActiveCategory('all')}
            className={`px-6 py-2 rounded-full transition-colors ${
              activeCategory === 'all'
                ? 'bg-primary text-white'
                : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
            }`}
          >
            Alle
          </button>
          <button
            onClick={() => setActiveCategory('video')}
            className={`px-6 py-2 rounded-full transition-colors flex items-center ${
              activeCategory === 'video'
                ? 'bg-primary text-white'
                : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
            }`}
          >
            <Video size={18} className="mr-2" />
            Optagelser
          </button>
          <button
            onClick={() => setActiveCategory('photo')}
            className={`px-6 py-2 rounded-full transition-colors flex items-center ${
              activeCategory === 'photo'
                ? 'bg-primary text-white'
                : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
            }`}
          >
            <Camera size={18} className="mr-2" />
            Billeder
          </button>
        </div>
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {Array.from({ length: 4 }).map((_, index) => (
              <ProductCardSkeleton key={index} />
            ))}
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="text-center py-16 max-w-md mx-auto">
            <Camera size={48} className="text-primary mx-auto mb-4" />
            <h2 className="text-2xl font-semibold mb-2">Ingen produkter fundet</h2>
            <p className="text-neutral-300 mb-6">
              Der er i øjeblikket ingen produkter tilgængelige i denne kategori.
            </p>
            <button
              onClick={() => setActiveCategory('all')}
              className="btn-primary"
            >
              Vis alle produkter
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {filteredProducts.map(product => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ProductsPage;
