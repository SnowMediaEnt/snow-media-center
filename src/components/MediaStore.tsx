import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, ShoppingCart, Plus, Minus, Star, Truck, Shield, Zap, Package, Trash2 } from 'lucide-react';
import { useWixStore, WixProduct, CartItem } from '@/hooks/useWixStore';
import { useCart } from '@/hooks/useCart';
import { useToast } from '@/hooks/use-toast';

interface MediaStoreProps {
  onBack: () => void;
}

const MediaStore = ({ onBack }: MediaStoreProps) => {
  const { products, loading, error, createCart } = useWixStore();
  const { cart, addToCart, removeFromCart, clearCart, updateQuantity } = useCart();
  const { toast } = useToast();
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<WixProduct | null>(null);

  const cartItems = cart.items;
  const cartTotal = cartItems.reduce((total, item) => total + (item.price * item.cartQuantity), 0);

  const handleCheckout = async () => {
    if (cartItems.length === 0) return;

    setCheckoutLoading(true);
    try {
      const wixCartItems: CartItem[] = cartItems.map(item => {
        const product = products.find(p => p.id === item.id);
        return {
          productId: item.id,
          quantity: item.quantity,
          name: product?.name || 'Unknown Product',
          price: product?.price || 0,
          image: product?.images[0]
        };
      });

      const { checkoutUrl } = await createCart(wixCartItems);
      
      if (checkoutUrl) {
        // Open Wix checkout in new window
        window.open(checkoutUrl, '_blank');
        clearCart(); // Clear local cart after redirecting to Wix
        toast({
          title: "Redirecting to Checkout",
          description: "Opening Wix checkout in a new window",
        });
      }
    } catch (error) {
      console.error('Checkout error:', error);
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
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 text-white p-8">
        <div className="max-w-6xl mx-auto">
          <Button 
            onClick={() => setSelectedProduct(null)}
            variant="outline" 
            size="lg"
            className="mb-6 bg-blue-600 border-blue-500 text-white hover:bg-blue-700"
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
                <p className="text-xl text-blue-200">{selectedProduct.description}</p>
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
                  <div className="space-y-3">
                    {selectedProduct.productOptions.map((option, index) => (
                      <div key={index}>
                        <span className="text-white/70 text-sm font-medium">{option.name}:</span>
                        <div className="flex flex-wrap gap-2 mt-1">
                          {option.choices.map((choice, choiceIndex) => (
                            <Badge key={choiceIndex} variant="secondary" className="bg-blue-600/20 text-blue-300">
                              {choice.value}
                            </Badge>
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
                      updateQuantity(selectedProduct.id, cartItem.quantity + 1);
                    } else {
                      addToCart({
                        id: selectedProduct.id,
                        name: selectedProduct.name,
                        price: selectedProduct.price,
                        quantity: 1,
                        images: selectedProduct.images
                      });
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
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 text-white p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center">
            <Button 
              onClick={onBack}
              variant="outline" 
              size="lg"
              className="mr-6 bg-blue-600 border-blue-500 text-white hover:bg-blue-700"
            >
              <ArrowLeft className="w-5 h-5 mr-2" />
              Back to Home
            </Button>
            <div>
              <h1 className="text-4xl font-bold text-white mb-2">Snow Media Store</h1>
              <p className="text-xl text-blue-200">Official Wix Store Integration</p>
            </div>
          </div>
          
          {/* Cart Summary */}
          <div className="flex items-center space-x-4">
            <Button
              variant="outline"
              size="lg"
              className="bg-green-600/20 border-green-500/50 text-white hover:bg-green-600/30"
            >
              <ShoppingCart className="w-5 h-5 mr-2" />
              Cart ({cartItems.length})
            </Button>
          </div>
        </div>

        {/* Cart Panel - Collapsible */}
        {cartItems.length > 0 && (
          <Card className="bg-gradient-to-br from-green-600/10 to-blue-600/10 border-green-500/20 mb-8">
            <CardContent className="p-6">
              <h3 className="text-lg font-semibold text-white mb-4">Shopping Cart</h3>
              <div className="space-y-3 mb-4">
                {cartItems.map((item) => (
                  <div key={item.id} className="flex items-center justify-between bg-white/5 p-3 rounded-lg">
                    <div className="flex items-center space-x-3">
                      <img src={item.image} alt={item.name} className="w-12 h-12 object-cover rounded" />
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
                          onClick={() => updateQuantity(item.id, Math.max(1, item.quantity - 1))}
                          className="bg-white/10 border-white/20 text-white"
                        >
                          <Minus className="w-3 h-3" />
                        </Button>
                        <span className="text-white font-medium px-2">{item.quantity}</span>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => updateQuantity(item.id, item.quantity + 1)}
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
          <h2 className="text-2xl font-bold text-white mb-6">All Products</h2>
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
              {products.map((product) => {
                const cartItem = cartItems.find(item => item.id === product.id);
                const isInCart = !!cartItem;
                
                return (
                  <Card key={product.id} className="bg-gradient-to-br from-blue-600/10 to-purple-600/10 border-blue-500/20 overflow-hidden hover:from-blue-600/20 hover:to-purple-600/20 transition-all duration-300">
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
                      <h3 className="text-lg font-semibold text-white mb-2 cursor-pointer hover:text-blue-300 transition-colors"
                          onClick={() => setSelectedProduct(product)}>
                        {product.name}
                      </h3>
                      <p className="text-white/70 text-sm mb-3 line-clamp-2">
                        {product.description}
                      </p>
                      
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
                                onClick={() => updateQuantity(product.id, Math.max(0, cartItem.quantity - 1))}
                                className="p-2 text-blue-400 hover:text-blue-300"
                              >
                                <Minus className="w-4 h-4" />
                              </button>
                              <span className="px-3 py-2 text-white">{cartItem.quantity}</span>
                              <button
                                onClick={() => updateQuantity(product.id, cartItem.quantity + 1)}
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
                            addToCart({
                              id: product.id,
                              name: product.name,
                              price: product.price,
                              quantity: 1,
                              images: product.images
                            });
                              toast({
                                title: "Added to cart!",
                                description: `${product.name} has been added to your cart.`,
                              });
                            }}
                            disabled={!product.inStock}
                            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
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