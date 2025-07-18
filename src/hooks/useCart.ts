import { useState, useCallback } from 'react';
import { StoreProduct, CartItem, ShoppingCart } from '@/types/store';

export const useCart = () => {
  const [cart, setCart] = useState<ShoppingCart>({
    items: [],
    total: 0,
    shipping: 0,
    tax: 0,
    grandTotal: 0
  });

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
    setCart({
      items: [],
      total: 0,
      shipping: 0,
      tax: 0,
      grandTotal: 0
    });
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