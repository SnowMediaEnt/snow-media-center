import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

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
}

export interface CartItem {
  productId: string;
  quantity: number;
  name: string;
  price: number;
  image?: string;
}

export const useWixStore = () => {
  const [products, setProducts] = useState<WixProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProducts = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const { data, error: funcError } = await supabase.functions.invoke('wix-integration', {
        body: { action: 'get-products' }
      });

      if (funcError) throw funcError;

      // Transform Wix product data to our format
      const transformedProducts = data.products.map((product: any) => ({
        id: product.id,
        name: product.name,
        description: product.description || '',
        price: product.price?.price || 0,
        comparePrice: product.price?.comparePrice,
        images: product.media?.items?.map((item: any) => item.image?.url) || ['/placeholder.svg'],
        inStock: product.stock?.inStock !== false,
        inventory: product.stock?.quantity ? { quantity: product.stock.quantity } : undefined,
        productOptions: product.productOptions || []
      }));

      setProducts(transformedProducts);
    } catch (err) {
      console.error('Error fetching Wix products:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch products');
    } finally {
      setLoading(false);
    }
  };

  const createCart = async (items: CartItem[]) => {
    try {
      const { data, error: funcError } = await supabase.functions.invoke('wix-integration', {
        body: { 
          action: 'create-cart',
          items: items.map(item => ({
            productId: item.productId,
            quantity: item.quantity
          }))
        }
      });

      if (funcError) throw funcError;

      return {
        cart: data.cart,
        checkoutUrl: data.checkoutUrl
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