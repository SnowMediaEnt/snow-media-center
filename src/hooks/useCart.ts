import { useState, useCallback, useEffect } from 'react';
import { StoreProduct, CartItem, ShoppingCart } from '@/types/store';

const CART_STORAGE_KEY = 'snow_media_cart';

// Load cart from localStorage
const loadCartFromStorage = (): ShoppingCart => {
  try {
    const saved = localStorage.getItem(CART_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      // Validate the structure
      if (parsed.items && Array.isArray(parsed.items)) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('[Cart] Failed to load cart from storage:', e);
  }
  return {
    items: [],
    total: 0,
    shipping: 0,
    tax: 0,
    grandTotal: 0
  };
};

// Save cart to localStorage
const saveCartToStorage = (cart: ShoppingCart) => {
  try {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
  } catch (e) {
    console.warn('[Cart] Failed to save cart to storage:', e);
  }
};

export const useCart = () => {
  const [cart, setCart] = useState<ShoppingCart>(loadCartFromStorage);

  // Persist cart changes to localStorage
  useEffect(() => {
    saveCartToStorage(cart);
  }, [cart]);

  const calculateTotals = useCallback((items: CartItem[]) => {
    const total = items.reduce((sum, item) => sum + (item.price * item.cartQuantity), 0);
    const shipping = total > 75 ? 0 : 9.99; // Free shipping over $75
    const tax = total * 0.08; // 8% tax
    const grandTotal = total + shipping + tax;

    return { total, shipping, tax, grandTotal };
  }, []);

  const addToCart = useCallback((product: StoreProduct, quantity: number = 1) => {
    setCart(prevCart => {
      const existingItem = prevCart.items.find(item => item.id === product.id);
      let newItems: CartItem[];

      if (existingItem) {
        newItems = prevCart.items.map(item =>
          item.id === product.id
            ? { ...item, cartQuantity: item.cartQuantity + quantity }
            : item
        );
      } else {
        newItems = [...prevCart.items, { ...product, cartQuantity: quantity }];
      }

      const totals = calculateTotals(newItems);
      return {
        items: newItems,
        ...totals
      };
    });
  }, [calculateTotals]);

  const removeFromCart = useCallback((productId: string) => {
    setCart(prevCart => {
      const newItems = prevCart.items.filter(item => item.id !== productId);
      const totals = calculateTotals(newItems);
      return {
        items: newItems,
        ...totals
      };
    });
  }, [calculateTotals]);

  const updateQuantity = useCallback((productId: string, quantity: number) => {
    if (quantity <= 0) {
      // Remove item directly instead of calling removeFromCart to avoid circular dependency
      setCart(prevCart => {
        const newItems = prevCart.items.filter(item => item.id !== productId);
        const totals = calculateTotals(newItems);
        return {
          items: newItems,
          ...totals
        };
      });
      return;
    }

    setCart(prevCart => {
      const newItems = prevCart.items.map(item =>
        item.id === productId
          ? { ...item, cartQuantity: quantity }
          : item
      );
      const totals = calculateTotals(newItems);
      return {
        items: newItems,
        ...totals
      };
    });
  }, [calculateTotals]);

  const clearCart = useCallback(() => {
    const emptyCart = {
      items: [],
      total: 0,
      shipping: 0,
      tax: 0,
      grandTotal: 0
    };
    setCart(emptyCart);
    // Also clear from storage
    try {
      localStorage.removeItem(CART_STORAGE_KEY);
    } catch (e) {
      console.warn('[Cart] Failed to clear cart from storage:', e);
    }
  }, []);

  const getItemCount = useCallback(() => {
    return cart.items.reduce((sum, item) => sum + item.cartQuantity, 0);
  }, [cart.items]);

  return {
    cart,
    addToCart,
    removeFromCart,
    updateQuantity,
    clearCart,
    getItemCount
  };
};
