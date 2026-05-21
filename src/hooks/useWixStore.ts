import { useState, useEffect } from 'react';
import { invokeEdgeFunction } from '@/utils/edgeFunctions';

export interface WixProduct {
  id: string;
  name: string;
  description: string;
  price: number;
  comparePrice?: number;
  images: string[];
  inStock: boolean;
  inventory?: {
    quantity: number;
  };
  productOptions?: Array<{
    name: string;
    choices: Array<{
      value: string;
      description: string;
    }>;
  }>;
  ribbon?: string;
}

export interface CartItem {
  productId: string;
  quantity: number;
  name: string;
  price: number;
  image?: string;
}

interface CreateCartOptions {
  appUserId?: string;
  email?: string;
}

// Mock product data for testing - replace with real Wix data later
const mockProducts: WixProduct[] = [
  {
    id: 'mock-1',
    name: 'Android TV Box Pro',
    description: 'High-performance Android TV streaming device with 4K support',
    price: 89.99,
    comparePrice: 119.99,
    images: ['/placeholder.svg'],
    inStock: true,
    inventory: { quantity: 15 },
    productOptions: [
      {
        name: 'Storage',
        choices: [
          { value: '32GB', description: '32GB Storage' },
          { value: '64GB', description: '64GB Storage' }
        ]
      }
    ]
  },
  {
    id: 'mock-2',
    name: 'Premium IPTV Subscription',
    description: '12-month premium streaming service with 1000+ channels',
    price: 159.99,
    comparePrice: 199.99,
    images: ['/placeholder.svg'],
    inStock: true,
    inventory: { quantity: 50 }
  },
  {
    id: 'mock-3',
    name: 'Wireless Remote Control',
    description: 'Universal remote control with voice command and backlight',
    price: 24.99,
    images: ['/placeholder.svg'],
    inStock: true,
    inventory: { quantity: 8 }
  },
  {
    id: 'mock-4',
    name: 'Fire TV Stick 4K Max',
    description: 'Latest Fire TV Stick with enhanced Wi-Fi 6 support',
    price: 54.99,
    comparePrice: 69.99,
    images: ['/placeholder.svg'],
    inStock: false,
    inventory: { quantity: 0 }
  },
  {
    id: 'mock-5',
    name: 'HDMI Cable 4K Ultra',
    description: 'Premium HDMI cable supporting 4K@60Hz and HDR',
    price: 12.99,
    images: ['/placeholder.svg'],
    inStock: true,
    inventory: { quantity: 25 }
  }
];

const PRODUCTS_CACHE_KEY = 'wixStore:products:v1';
const PRODUCTS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const readProductsCache = (): WixProduct[] | null => {
  try {
    const raw = sessionStorage.getItem(PRODUCTS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { ts: number; products: WixProduct[] };
    if (!parsed?.products || !Array.isArray(parsed.products)) return null;
    if (Date.now() - (parsed.ts || 0) > PRODUCTS_CACHE_TTL_MS) return null;
    return parsed.products;
  } catch {
    return null;
  }
};

const writeProductsCache = (products: WixProduct[]) => {
  try {
    sessionStorage.setItem(
      PRODUCTS_CACHE_KEY,
      JSON.stringify({ ts: Date.now(), products })
    );
  } catch {
    // ignore — sessionStorage may be unavailable / quota exceeded
  }
};

export const useWixStore = () => {
  // Hydrate synchronously from cache so the store renders instantly on re-entry.
  const cached = typeof window !== 'undefined' ? readProductsCache() : null;
  const [products, setProducts] = useState<WixProduct[]>(cached ?? []);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);

  const fetchProducts = async () => {
    console.log('[WixStore] Starting product fetch...');
    // Only show the skeleton when we have nothing on screen yet.
    setError(null);
    
    try {
      const { data, error: funcError } = await invokeEdgeFunction<{
        products?: any[];
        error?: string;
        details?: unknown;
      }>('wix-integration', {
        body: { action: 'get-products' },
        timeout: 20000, // 20s timeout
        retries: 2,
      });

      if (funcError) {
        console.error('[WixStore] Function error:', funcError);
        throw funcError;
      }

      if (data?.error) {
        console.error('[WixStore] API error response:', data);
        throw new Error(data.error + (data.details ? ` - ${JSON.stringify(data.details)}` : ''));
      }

      console.log('[WixStore] Products loaded:', data?.products?.length || 0);
      
      // Transform Wix product data to our format
      const transformedProducts = (data?.products || []).map((product: any) => ({
        id: product.id,
        name: product.name,
        description: product.description || '',
        price: product.price?.price || 0,
        comparePrice: product.price?.comparePrice,
        images: product.media?.items?.map((item: any) => item.image?.url) || ['/placeholder.svg'],
        inStock: product.stock?.inStock !== false,
        inventory: product.stock?.quantity ? { quantity: product.stock.quantity } : undefined,
        productOptions: product.productOptions || [],
        ribbon: product.ribbon || product.customTextFields?.ribbon || ''
      }));

      const next = transformedProducts.length > 0 ? transformedProducts : mockProducts;
      setProducts(next);
      writeProductsCache(next);
      console.log('[WixStore] Products set successfully');
    } catch (err) {
      console.error('[WixStore] Error loading products:', err);
      setError(err instanceof Error ? err.message : 'Failed to load products');
      // Only fall back to mock products if we have nothing cached on screen.
      setProducts((prev) => (prev.length > 0 ? prev : mockProducts));
    } finally {
      setLoading(false);
    }
  };

  const createCart = async (items: CartItem[], options: CreateCartOptions = {}) => {
    try {
      const { data, error: funcError } = await invokeEdgeFunction<{
        cart: unknown;
        checkoutUrl: string;
      }>('wix-integration', {
        body: { 
          action: 'create-cart',
          appUserId: options.appUserId,
          email: options.email,
          items: items.map(item => ({
            productId: item.productId,
            quantity: item.quantity
          }))
        },
        timeout: 30000,
        retries: 3,
      });

      if (funcError) throw funcError;

      return {
        cart: data?.cart,
        checkoutUrl: data?.checkoutUrl
      };
    } catch (err) {
      console.error('Error creating cart:', err);
      throw err;
    }
  };

  useEffect(() => {
    console.log('[WixStore] useEffect mounting, calling fetchProducts...');
    fetchProducts();
    
    // Safety fallback: if loading takes too long, show mock products
    const safetyTimeout = setTimeout(() => {
      setLoading(prev => {
        if (prev) {
          console.warn('[WixStore] Safety timeout - loading took too long, showing fallback');
          setProducts((p) => (p.length > 0 ? p : mockProducts));
          return false;
        }
        return prev;
      });
    }, 25000);
    
    return () => clearTimeout(safetyTimeout);
  }, []);

  return {
    products,
    loading,
    error,
    fetchProducts,
    createCart
  };
};
