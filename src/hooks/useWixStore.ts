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

export const useWixStore = () => {
  const [products, setProducts] = useState<WixProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProducts = async () => {
    setLoading(true);
    setError(null);
    
    try {
      console.log('Calling Wix integration function...');
      
      const { data, error: funcError } = await invokeEdgeFunction<{
        products?: any[];
        error?: string;
        details?: unknown;
      }>('wix-integration', {
        body: { action: 'get-products' },
        timeout: 30000, // 30s timeout for product catalog
        retries: 3,
      });

      if (funcError) {
        console.error('Function error:', funcError);
        throw funcError;
      }

      if (data?.error) {
        console.error('API error response:', data);
        throw new Error(data.error + (data.details ? ` - ${JSON.stringify(data.details)}` : ''));
      }

      console.log('Wix products loaded:', data);
      
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

      setProducts(transformedProducts.length > 0 ? transformedProducts : mockProducts);
      console.log('Products set successfully');
    } catch (err) {
      console.error('Error loading products:', err);
      setError(err instanceof Error ? err.message : 'Failed to load products');
      // Fall back to mock products on error
      setProducts(mockProducts);
    } finally {
      setLoading(false);
    }
  };

  const createCart = async (items: CartItem[]) => {
    try {
      const { data, error: funcError } = await invokeEdgeFunction<{
        cart: unknown;
        checkoutUrl: string;
      }>('wix-integration', {
        body: { 
          action: 'create-cart',
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
    fetchProducts();
  }, []);

  return {
    products,
    loading,
    error,
    fetchProducts,
    createCart
  };
};
