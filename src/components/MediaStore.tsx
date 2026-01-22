import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, ShoppingCart, Plus, Minus, Truck, Shield, Zap, Package, Trash2, Smartphone, Headphones, Cable, Wrench, LogIn, User } from 'lucide-react';
import { useWixStore, WixProduct, CartItem } from '@/hooks/useWixStore';
import { useCart } from '@/hooks/useCart';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
interface MediaStoreProps {
  onBack: () => void;
}

const MediaStore = ({ onBack }: MediaStoreProps) => {
  const { products, loading, error, createCart } = useWixStore();
  const { cart, addToCart, removeFromCart, clearCart, updateQuantity } = useCart();
  const { toast } = useToast();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<WixProduct | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [focusedElement, setFocusedElement] = useState<'back' | 'signin' | 'cart' | string>('back');

  // TV Remote Navigation with checkout support
  // Focus types: 'back', 'signin', 'cart', 'category-{id}', 'product-{id}'
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Handle Android back button
      if (event.key === 'Escape' || event.key === 'Backspace' || 
          event.keyCode === 4 || event.which === 4) {
        event.preventDefault();
        event.stopPropagation();
        if (selectedProduct) {
          setSelectedProduct(null);
        } else {
          onBack();
        }
        return;
      }
      
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
      }
      
      const filteredProducts = getFilteredProducts();
      const categoryIds = categories.map(c => `category-${c.id}`);
      
      // Define sections in order: header (back, signin, cart) -> categories -> products
      const headerItems = user ? ['back', 'cart'] : ['back', 'signin', 'cart'];
      const productItems = filteredProducts.map(p => `product-${p.id}`);
      
      // Get grid dimensions (assume 4 columns for products)
      const gridCols = 4;
      
      switch (event.key) {
        case 'ArrowLeft':
          if (focusedElement === 'signin') {
            setFocusedElement('back');
          } else if (focusedElement === 'cart') {
            setFocusedElement(user ? 'back' : 'signin');
          } else if (focusedElement.startsWith('category-')) {
            const idx = categoryIds.indexOf(focusedElement);
            if (idx > 0) {
              setFocusedElement(categoryIds[idx - 1]);
            }
          } else if (focusedElement.startsWith('product-')) {
            const currentIndex = filteredProducts.findIndex(p => focusedElement === `product-${p.id}`);
            if (currentIndex > 0 && currentIndex % gridCols !== 0) {
              setFocusedElement(`product-${filteredProducts[currentIndex - 1].id}`);
            }
          }
          break;
          
        case 'ArrowRight':
          if (focusedElement === 'back') {
            setFocusedElement(user ? 'cart' : 'signin');
          } else if (focusedElement === 'signin') {
            setFocusedElement('cart');
          } else if (focusedElement.startsWith('category-')) {
            const idx = categoryIds.indexOf(focusedElement);
            if (idx < categoryIds.length - 1) {
              setFocusedElement(categoryIds[idx + 1]);
            }
          } else if (focusedElement.startsWith('product-')) {
            const currentIndex = filteredProducts.findIndex(p => focusedElement === `product-${p.id}`);
            if (currentIndex < filteredProducts.length - 1 && (currentIndex + 1) % gridCols !== 0) {
              setFocusedElement(`product-${filteredProducts[currentIndex + 1].id}`);
            }
          }
          break;
          
        case 'ArrowUp':
          if (focusedElement.startsWith('product-')) {
            const currentIndex = filteredProducts.findIndex(p => focusedElement === `product-${p.id}`);
            if (currentIndex >= gridCols) {
              // Move up one row in grid
              setFocusedElement(`product-${filteredProducts[currentIndex - gridCols].id}`);
            } else {
              // Move from first row of products to categories
              setFocusedElement(categoryIds[0] || 'back');
            }
          } else if (focusedElement.startsWith('category-')) {
            // Move from categories to signin/cart row
            setFocusedElement(user ? 'cart' : 'signin');
          } else if (focusedElement === 'signin') {
            setFocusedElement('back');
          } else if (focusedElement === 'cart') {
            setFocusedElement(user ? 'back' : 'signin');
          }
          break;
          
        case 'ArrowDown':
          if (focusedElement === 'back') {
            // From back, go to cart (skip signin for simpler navigation)
            setFocusedElement('cart');
          } else if (focusedElement === 'signin') {
            // From signin, go to cart
            setFocusedElement('cart');
          } else if (focusedElement === 'cart') {
            // From cart, go to categories
            if (categoryIds.length > 0) {
              setFocusedElement(categoryIds[0]);
            } else if (filteredProducts.length > 0) {
              setFocusedElement(`product-${filteredProducts[0].id}`);
            }
          } else if (focusedElement.startsWith('category-')) {
            // Move from categories to first product
            if (filteredProducts.length > 0) {
              setFocusedElement(`product-${filteredProducts[0].id}`);
            }
          } else if (focusedElement.startsWith('product-')) {
            const currentIndex = filteredProducts.findIndex(p => focusedElement === `product-${p.id}`);
            if (currentIndex + gridCols < filteredProducts.length) {
              // Move down one row in grid
              setFocusedElement(`product-${filteredProducts[currentIndex + gridCols].id}`);
            }
          }
          break;
          
        case 'Enter':
        case ' ':
          if (focusedElement === 'back') onBack();
          else if (focusedElement === 'signin') navigate('/auth');
          else if (focusedElement === 'cart') handleCheckout();
          else if (focusedElement.startsWith('category-')) {
            const catId = focusedElement.replace('category-', '');
            setSelectedCategory(catId);
          } else if (focusedElement.startsWith('product-')) {
            const product = filteredProducts.find(p => focusedElement === `product-${p.id}`);
            if (product) setSelectedProduct(product);
          }
          break;
          
        // Add checkout shortcut
        case 'c':
        case 'C':
          if (cartItems.length > 0) {
            handleCheckout();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusedElement, selectedProduct, onBack, navigate, user, products, selectedCategory, cart]);

  // Scroll focused element into view for TV navigation - always keep selector visible
  useEffect(() => {
    const el = document.querySelector(`[data-focus-id="${focusedElement}"]`) as HTMLElement;
    if (!el) return;
    
    const rect = el.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const margin = 150; // Extra margin for visibility
    
    // Check if element is off-screen in any direction
    if (rect.top < margin) {
      // Element is above viewport - scroll up
      window.scrollTo({ top: Math.max(0, window.scrollY + rect.top - margin), behavior: 'smooth' });
    } else if (rect.bottom > viewportHeight - margin) {
      // Element is below viewport - scroll down to make it visible
      window.scrollTo({ top: window.scrollY + rect.bottom - viewportHeight + margin, behavior: 'smooth' });
    }
  }, [focusedElement]);

  const cartItems = cart.items;
  const cartTotal = cartItems.reduce((total, item) => total + (item.price * item.cartQuantity), 0);

  // Category configuration
  const categories = [
    { id: 'All', name: 'All Products', icon: Package },
    { id: 'Devices', name: 'Devices', icon: Smartphone },
    { id: 'Services', name: 'Services', icon: Zap },
    { id: 'Accessories', name: 'Accessories', icon: Headphones },
    { id: 'Support Tools', name: 'Support Tools', icon: Wrench }
  ];

  // Filter products by category (this is a simple example - you'd want to add category metadata to your Wix products)
  const getFilteredProducts = () => {
    if (selectedCategory === 'All') return products;
    
    return products.filter(product => {
      const name = product.name.toLowerCase();
      const description = product.description.toLowerCase();
      const category = (product as any).ribbon?.toLowerCase() || '';
      
      switch (selectedCategory) {
        case 'Devices':
          return category.includes('device') || name.includes('device') || name.includes('box') || name.includes('stick') || name.includes('player') || name.includes('tablet') || name.includes('phone') || name.includes('x96') || name.includes('android');
        case 'Services':
          return category.includes('service') || name.includes('service') || name.includes('subscription') || name.includes('setup') || name.includes('installation') || name.includes('support') || name.includes('connection') || name.includes('backup');
        case 'Accessories':
          return category.includes('accessory') || name.includes('cable') || name.includes('remote') || name.includes('adapter') || name.includes('case') || name.includes('accessory') || name.includes('mount');
        case 'Support Tools':
          return category.includes('support') || name.includes('tool') || name.includes('software') || name.includes('guide') || name.includes('tutorial') || name.includes('help') || name.includes('credit');
        default:
          return true;
      }
    });
  };

  const handleCheckout = async () => {
    if (cartItems.length === 0) return;

    setCheckoutLoading(true);
    
    // For web: Open window BEFORE async call to avoid popup blocker
    // Must open synchronously in response to user action
    let checkoutWindow: Window | null = null;
    if (!Capacitor.isNativePlatform()) {
      checkoutWindow = window.open('about:blank', '_blank');
    }
    
    try {
      const wixCartItems: CartItem[] = cartItems.map(item => ({
        productId: item.id,
        quantity: item.cartQuantity,
        name: item.name,
        price: item.price,
        image: item.images?.[0] || ''
      }));

      const { checkoutUrl } = await createCart(wixCartItems);
      
      if (checkoutUrl) {
        clearCart();
        
        // Check if running on native platform (Android/iOS)
        if (Capacitor.isNativePlatform()) {
          toast({
            title: "Opening Checkout",
            description: "Use the close button (X) to return to the store",
          });
          // Open in-app browser with close button for better TV experience
          await Browser.open({ 
            url: checkoutUrl,
            presentationStyle: 'fullscreen',
            toolbarColor: '#000000'
          });
        } else {
          // Web: Navigate the pre-opened window to checkout URL
          if (checkoutWindow) {
            checkoutWindow.location.href = checkoutUrl;
            toast({
              title: "Opening Checkout",
              description: "Checkout opened in a new tab. Close it to return here.",
            });
          } else {
            // Fallback if popup was blocked
            toast({
              title: "Popup Blocked",
              description: "Please allow popups or click the link below.",
              variant: "destructive",
            });
            // Use location.href as last resort
            window.location.href = checkoutUrl;
          }
        }
      } else {
        // No checkout URL - close the blank window
        checkoutWindow?.close();
        toast({
          title: "Checkout Error",
          description: "Could not get checkout URL. Please try again.",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Checkout error:', error);
      // Close blank window on error
      checkoutWindow?.close();
      toast({
        title: "Checkout Error",
        description: "Unable to process checkout. Please try again.",
        variant: "destructive",
      });
    } finally {
      setCheckoutLoading(false);
    }
  };

  if (selectedProduct) {
    return (
      <div className="tv-scroll-container tv-safe text-white">
        <div className="max-w-6xl mx-auto pb-16">
          <Button 
            onClick={() => setSelectedProduct(null)}
            variant="outline" 
            size="lg"
            className="mb-6 bg-brand-gold text-white hover:bg-brand-gold/80"
          >
            <ArrowLeft className="w-5 h-5 mr-2" />
            Back to Products
          </Button>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Product Images */}
            <div className="space-y-4">
              <div className="aspect-square bg-slate-700 rounded-lg overflow-hidden">
                <img 
                  src={selectedProduct.images[0]} 
                  alt={selectedProduct.name}
                  className="w-full h-full object-cover"
                />
              </div>
            </div>

            {/* Product Details */}
            <div className="space-y-6">
              <div>
                <h1 className="text-4xl font-bold text-white mb-2">{selectedProduct.name}</h1>
                <div 
                  className="text-xl text-blue-200" 
                  dangerouslySetInnerHTML={{ __html: selectedProduct.description }}
                />
              </div>

              <div className="flex items-center space-x-4">
                <span className="text-3xl font-bold text-green-400">${selectedProduct.price.toFixed(2)}</span>
                {selectedProduct.comparePrice && selectedProduct.comparePrice > selectedProduct.price && (
                  <span className="text-xl text-slate-400 line-through">${selectedProduct.comparePrice.toFixed(2)}</span>
                )}
                <Badge className={`${selectedProduct.inStock ? 'bg-green-600' : 'bg-red-600'} text-white`}>
                  {selectedProduct.inStock ? 
                    (selectedProduct.inventory?.quantity ? `${selectedProduct.inventory.quantity} in stock` : 'In stock') : 
                    'Out of stock'
                  }
                </Badge>
              </div>

              {/* Product Options */}
              {selectedProduct.productOptions && selectedProduct.productOptions.length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold text-white mb-3">Product Options:</h3>
                  <div className="space-y-4">
                    {selectedProduct.productOptions.map((option, index) => (
                      <div key={index} className="bg-white/5 p-4 rounded-lg">
                        <label className="text-white font-medium mb-2 block">{option.name}:</label>
                        <div className="grid grid-cols-2 gap-2">
                          {option.choices.map((choice, choiceIndex) => (
                            <button
                              key={choiceIndex}
                              className="bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-300 p-2 rounded text-sm transition-colors"
                            >
                              {choice.value}
                              {(choice as any).priceModifier && (
                                <span className="text-xs ml-1">
                                  ({(choice as any).priceModifier > 0 ? '+' : ''}${(choice as any).priceModifier.toFixed(2)})
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Add to Cart Section */}
              <div className="flex items-center space-x-4 pt-6 border-t border-slate-600">
                <Button
                  onClick={() => {
                    const cartItem = cartItems.find(item => item.id === selectedProduct.id);
                    if (cartItem) {
                      updateQuantity(selectedProduct.id, cartItem.cartQuantity + 1);
                    } else {
                      addToCart(selectedProduct as any, 1);
                    }
                    toast({
                      title: "Added to cart!",
                      description: `${selectedProduct.name} has been added to your cart.`,
                    });
                  }}
                  disabled={!selectedProduct.inStock}
                  size="lg"
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white text-lg"
                >
                  <ShoppingCart className="w-5 h-5 mr-2" />
                  Add to Cart - ${selectedProduct.price.toFixed(2)}
                </Button>
              </div>

              {/* Trust Badges */}
              <div className="flex justify-center space-x-8 pt-6 border-t border-slate-600">
                <div className="flex items-center space-x-2 text-green-400">
                  <Truck className="w-5 h-5" />
                  <span className="text-sm">Free Shipping</span>
                </div>
                <div className="flex items-center space-x-2 text-blue-400">
                  <Shield className="w-5 h-5" />
                  <span className="text-sm">Secure Checkout</span>
                </div>
                <div className="flex items-center space-x-2 text-purple-400">
                  <Zap className="w-5 h-5" />
                  <span className="text-sm">Fast Delivery</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="tv-scroll-container tv-safe text-white">
      <div className="max-w-7xl mx-auto pb-16">
        {/* Header */}
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-center w-full justify-between">
            <Button 
              onClick={onBack}
              variant="gold" 
              size="lg"
              className={focusedElement === 'back' ? 'ring-2 ring-brand-ice' : ''}
            >
              <ArrowLeft className="w-5 h-5 mr-2" />
              Back to Home
            </Button>
            <div className="invisible">
              <Button variant="gold" size="lg">Placeholder</Button>
            </div>
          </div>
          <div className="text-center mt-4">
            <h1 className="text-4xl font-bold text-white mb-2">Snow Media Store</h1>
            <p className="text-xl text-blue-200">Official Wix Store Integration</p>
          </div>
        </div>
          
        {/* Top Right Controls */}
        <div className="flex items-center space-x-4 mb-8">
          {user ? (
            <div className="flex items-center space-x-2 bg-green-600/20 border border-green-500/50 rounded-lg px-3 py-2">
              <User className="w-4 h-4 text-green-400" />
              <span className="text-green-400 text-sm">Signed In</span>
            </div>
          ) : (
            <Button
              onClick={() => navigate('/auth')}
              variant="outline"
              size="sm"
              className={`bg-blue-600/20 border-blue-500/50 text-white hover:bg-blue-600/30 ${focusedElement === 'signin' ? 'ring-2 ring-brand-ice' : ''}`}
            >
              <LogIn className="w-4 h-4 mr-2" />
              Sign In
            </Button>
          )}
          <Button
            variant="outline"
            size="lg"
            className={`bg-green-600/20 border-green-500/50 text-white hover:bg-green-600/30 ${focusedElement === 'cart' ? 'ring-2 ring-brand-ice' : ''}`}
          >
            <ShoppingCart className="w-5 h-5 mr-2" />
            Cart ({cartItems.length})
          </Button>
        </div>

        {/* Category Filter */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-white mb-4">Categories</h2>
          <div className="flex flex-wrap gap-3">
            {categories.map((category) => {
              const Icon = category.icon;
              const isSelected = selectedCategory === category.id;
              
              return (
                <Button
                  key={category.id}
                  data-focus-id={`category-${category.id}`}
                  onClick={() => setSelectedCategory(category.id)}
                  variant={isSelected ? "default" : "outline"}
                  className={`${
                    isSelected 
                      ? 'bg-brand-gold border-brand-gold text-white' 
                      : 'bg-white/10 border-white/20 text-white hover:bg-white/20'
                  } ${focusedElement === `category-${category.id}` ? 'ring-2 ring-brand-ice scale-105' : ''}`}
                >
                  <Icon className="w-4 h-4 mr-2" />
                  {category.name}
                </Button>
              );
            })}
          </div>
        </div>

        {/* Cart Panel */}
        {cartItems.length > 0 && (
          <Card className="bg-gradient-to-br from-green-600/20 to-blue-600/20 border-green-500/30 mb-8">
            <CardContent className="p-6">
              <h3 className="text-lg font-semibold text-white mb-4">Shopping Cart</h3>
              <div className="space-y-3 mb-4">
                {cartItems.map((item) => (
                  <div key={item.id} className="flex items-center justify-between bg-white/5 p-3 rounded-lg">
                    <div className="flex items-center space-x-3">
                      <img src={item.images[0]} alt={item.name} className="w-12 h-12 object-cover rounded" />
                      <div>
                        <h4 className="text-white font-medium">{item.name}</h4>
                        <p className="text-white/60 text-sm">${item.price.toFixed(2)} each</p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-3">
                      <div className="flex items-center space-x-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => updateQuantity(item.id, Math.max(1, item.cartQuantity - 1))}
                          className="bg-white/10 border-white/20 text-white"
                        >
                          <Minus className="w-3 h-3" />
                        </Button>
                        <span className="text-white font-medium px-2">{item.cartQuantity}</span>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => updateQuantity(item.id, item.cartQuantity + 1)}
                          className="bg-white/10 border-white/20 text-white"
                        >
                          <Plus className="w-3 h-3" />
                        </Button>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => removeFromCart(item.id)}
                        className="bg-red-600/20 border-red-500/30 text-red-400 hover:bg-red-600/30"
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between pt-4 border-t border-white/10">
                <div className="text-xl font-bold text-white">
                  Total: ${cartTotal.toFixed(2)}
                </div>
                <div className="flex space-x-2">
                  <Button 
                    onClick={handleCheckout}
                    disabled={checkoutLoading || cartItems.length === 0}
                    className="bg-green-600 hover:bg-green-700 text-white"
                  >
                    {checkoutLoading ? 'Processing...' : `Checkout with Wix ($${cartTotal.toFixed(2)})`}
                  </Button>
                  <Button 
                    onClick={clearCart}
                    variant="outline"
                    className="bg-red-600/20 border-red-500/30 text-red-400 hover:bg-red-600/30"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Products Grid */}
        <div>
          <h2 className="text-2xl font-bold text-white mb-6">
            {selectedCategory === 'All' ? 'All Products' : categories.find(c => c.id === selectedCategory)?.name}
          </h2>
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {[...Array(8)].map((_, i) => (
                <Card key={i} className="bg-gradient-to-br from-blue-600/10 to-purple-600/10 border-blue-500/20 animate-pulse">
                  <div className="h-48 bg-white/10"></div>
                  <CardContent className="p-4 space-y-2">
                    <div className="h-4 bg-white/10 rounded"></div>
                    <div className="h-3 bg-white/10 rounded w-3/4"></div>
                    <div className="h-6 bg-white/10 rounded w-1/2"></div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : error ? (
            <div className="text-center py-8">
              <p className="text-red-400 mb-4">Failed to load products from Wix store</p>
              <p className="text-white/60 text-sm">{error}</p>
              <Button 
                onClick={() => window.location.reload()} 
                className="mt-4 bg-blue-600 hover:bg-blue-700"
              >
                Retry
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {getFilteredProducts().map((product) => {
                const cartItem = cartItems.find(item => item.id === product.id);
                const isInCart = !!cartItem;
                
                return (
                  <Card 
                    key={product.id} 
                    data-focus-id={`product-${product.id}`}
                    className={`bg-gradient-to-br from-blue-600/20 to-purple-600/20 border-blue-500/30 overflow-hidden hover:from-blue-600/30 hover:to-purple-600/30 transition-all duration-300 ${focusedElement === `product-${product.id}` ? 'ring-4 ring-brand-ice scale-105' : ''}`}
                  >
                    <div className="relative">
                      <img 
                        src={product.images[0]} 
                        alt={product.name}
                        className="w-full h-48 object-cover cursor-pointer"
                        onClick={() => setSelectedProduct(product)}
                      />
                      {product.comparePrice && product.comparePrice > product.price && (
                        <div className="absolute top-2 right-2 bg-red-500 text-white px-2 py-1 rounded-full text-sm font-semibold">
                          Save ${(product.comparePrice - product.price).toFixed(2)}
                        </div>
                      )}
                    </div>
                    
                    <CardContent className="p-4">
                      <h3 className="text-lg font-semibold text-white mb-2 cursor-pointer hover:text-blue-300 transition-colors line-clamp-1"
                          onClick={() => setSelectedProduct(product)}>
                        {product.name}
                      </h3>
                       <div 
                         className="text-white/70 text-sm mb-3 line-clamp-2 max-h-10 overflow-hidden"
                         dangerouslySetInnerHTML={{ __html: product.description }}
                       />
                      
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center space-x-2">
                          <span className="text-xl font-bold text-green-400">
                            ${product.price.toFixed(2)}
                          </span>
                          {product.comparePrice && product.comparePrice > product.price && (
                            <span className="text-sm text-white/50 line-through">
                              ${product.comparePrice.toFixed(2)}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center">
                          {product.inStock && product.inventory?.quantity ? (
                            <div className="flex items-center text-green-400 text-sm">
                              <Package className="w-4 h-4 mr-1" />
                              {product.inventory.quantity} in stock
                            </div>
                          ) : product.inStock ? (
                            <div className="flex items-center text-green-400 text-sm">
                              <Package className="w-4 h-4 mr-1" />
                              In stock
                            </div>
                          ) : (
                            <div className="flex items-center text-red-400 text-sm">
                              <Package className="w-4 h-4 mr-1" />
                              Out of stock
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex space-x-2">
                        {isInCart ? (
                          <div className="flex items-center space-x-2 w-full">
                            <div className="flex items-center bg-blue-600/20 border border-blue-500/30 rounded-lg">
                              <button
                                onClick={() => updateQuantity(product.id, Math.max(0, cartItem.cartQuantity - 1))}
                                className="p-2 text-blue-400 hover:text-blue-300"
                              >
                                <Minus className="w-4 h-4" />
                              </button>
                              <span className="px-3 py-2 text-white">{cartItem.cartQuantity}</span>
                              <button
                                onClick={() => updateQuantity(product.id, cartItem.cartQuantity + 1)}
                                className="p-2 text-blue-400 hover:text-blue-300"
                              >
                                <Plus className="w-4 h-4" />
                              </button>
                            </div>
                            <Button
                              onClick={() => removeFromCart(product.id)}
                              variant="outline"
                              size="sm"
                              className="bg-red-600/20 border-red-500/30 text-red-400 hover:bg-red-600/30"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        ) : (
                          <Button
                            onClick={() => {
                              addToCart(product as any, 1);
                              toast({
                                title: "Added to cart!",
                                description: `${product.name} has been added to your cart.`,
                              });
                            }}
                            disabled={!product.inStock}
                            className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                          >
                            <ShoppingCart className="w-4 h-4 mr-2" />
                            Add to Cart
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MediaStore;