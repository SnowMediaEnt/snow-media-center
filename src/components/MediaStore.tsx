import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, ShoppingCart, Plus, Minus, Star, Truck, Shield, Zap } from 'lucide-react';
import WixVerification from './WixVerification';
import { storeProducts, getProductsByCategory, getFeaturedProducts } from '@/data/storeProducts';
import { useCart } from '@/hooks/useCart';
import { useToast } from '@/hooks/use-toast';
import { StoreProduct } from '@/types/store';

interface MediaStoreProps {
  onBack: () => void;
}

const MediaStore = ({ onBack }: MediaStoreProps) => {
  const [selectedProduct, setSelectedProduct] = useState<StoreProduct | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const { cart, addToCart, getItemCount } = useCart();
  const { toast } = useToast();

  const handleAddToCart = (product: StoreProduct, quantity: number = 1) => {
    addToCart(product, quantity);
    toast({
      title: "Added to cart!",
      description: `${product.name} has been added to your cart.`,
    });
  };

  const updateQuantity = (productId: string, quantity: number) => {
    setQuantities(prev => ({
      ...prev,
      [productId]: Math.max(1, quantity)
    }));
  };

  const getQuantity = (productId: string) => quantities[productId] || 1;

  const ProductCard = ({ product }: { product: StoreProduct }) => {
    const quantity = getQuantity(product.id);
    const isOnSale = product.originalPrice && product.originalPrice > product.price;

    return (
      <Card
        className="bg-gradient-to-br from-slate-800 to-slate-900 border-slate-700 p-6 cursor-pointer hover:scale-105 transition-transform duration-300 relative overflow-hidden"
        onClick={() => setSelectedProduct(product)}
      >
        {isOnSale && (
          <Badge className="absolute top-4 right-4 bg-red-600 text-white">
            SALE
          </Badge>
        )}
        
        {!product.inStock && (
          <Badge className="absolute top-4 left-4 bg-gray-600 text-white">
            OUT OF STOCK
          </Badge>
        )}

        <div className="aspect-video bg-slate-700 rounded-lg mb-4 flex items-center justify-center">
          <div className="text-slate-400 text-4xl font-bold">
            {product.category === 'android-devices' ? '📱' :
             product.category === 'fire-tv' ? '🔥' :
             product.category === 'streaming-boxes' ? '📺' : '🔌'}
          </div>
        </div>
        
        <div className="space-y-3">
          <div>
            <h3 className="text-xl font-bold text-white mb-1">{product.name}</h3>
            <p className="text-blue-200 text-sm line-clamp-2">{product.description}</p>
          </div>
          
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <span className="text-2xl font-bold text-green-400">${product.price}</span>
              {isOnSale && (
                <span className="text-lg text-slate-400 line-through">${product.originalPrice}</span>
              )}
            </div>
            <div className="flex items-center text-yellow-400">
              <Star className="w-4 h-4 fill-current" />
              <Star className="w-4 h-4 fill-current" />
              <Star className="w-4 h-4 fill-current" />
              <Star className="w-4 h-4 fill-current" />
              <Star className="w-4 h-4 fill-current" />
            </div>
          </div>

          <div className="flex flex-wrap gap-1">
            {product.features.slice(0, 3).map((feature, index) => (
              <Badge key={index} variant="secondary" className="text-xs bg-blue-600/20 text-blue-300">
                {feature}
              </Badge>
            ))}
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-slate-600">
            <div className="flex items-center space-x-2">
              <Button
                size="sm"
                variant="outline"
                onClick={(e) => {
                  e.stopPropagation();
                  updateQuantity(product.id, quantity - 1);
                }}
                disabled={quantity <= 1}
                className="w-8 h-8 p-0 bg-slate-700 border-slate-600"
              >
                <Minus className="w-3 h-3" />
              </Button>
              <span className="text-white font-medium w-8 text-center">{quantity}</span>
              <Button
                size="sm"
                variant="outline"
                onClick={(e) => {
                  e.stopPropagation();
                  updateQuantity(product.id, quantity + 1);
                }}
                disabled={quantity >= product.quantity}
                className="w-8 h-8 p-0 bg-slate-700 border-slate-600"
              >
                <Plus className="w-3 h-3" />
              </Button>
            </div>
            
            <Button
              onClick={(e) => {
                e.stopPropagation();
                handleAddToCart(product, quantity);
              }}
              disabled={!product.inStock}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              <ShoppingCart className="w-4 h-4 mr-2" />
              Add to Cart
            </Button>
          </div>
        </div>
      </Card>
    );
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
              <div className="aspect-square bg-slate-700 rounded-lg flex items-center justify-center">
                <div className="text-slate-400 text-8xl">
                  {selectedProduct.category === 'android-devices' ? '📱' :
                   selectedProduct.category === 'fire-tv' ? '🔥' :
                   selectedProduct.category === 'streaming-boxes' ? '📺' : '🔌'}
                </div>
              </div>
            </div>

            {/* Product Details */}
            <div className="space-y-6">
              <div>
                <h1 className="text-4xl font-bold text-white mb-2">{selectedProduct.name}</h1>
                <p className="text-xl text-blue-200">{selectedProduct.description}</p>
              </div>

              <div className="flex items-center space-x-4">
                <span className="text-3xl font-bold text-green-400">${selectedProduct.price}</span>
                {selectedProduct.originalPrice && selectedProduct.originalPrice > selectedProduct.price && (
                  <span className="text-xl text-slate-400 line-through">${selectedProduct.originalPrice}</span>
                )}
                <Badge className="bg-green-600 text-white">
                  {selectedProduct.inStock ? `${selectedProduct.quantity} in stock` : 'Out of stock'}
                </Badge>
              </div>

              {/* Features */}
              <div>
                <h3 className="text-lg font-semibold text-white mb-3">Key Features:</h3>
                <div className="grid grid-cols-1 gap-2">
                  {selectedProduct.features.map((feature, index) => (
                    <div key={index} className="flex items-center space-x-2">
                      <div className="w-2 h-2 bg-green-400 rounded-full flex-shrink-0" />
                      <span className="text-blue-200">{feature}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Specifications */}
              <div>
                <h3 className="text-lg font-semibold text-white mb-3">Specifications:</h3>
                <div className="grid grid-cols-2 gap-3">
                  {Object.entries(selectedProduct.specifications).map(([key, value]) => (
                    <div key={key} className="border border-slate-600 rounded p-2">
                      <div className="text-sm text-slate-400">{key}</div>
                      <div className="text-white font-medium">{value}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Add to Cart Section */}
              <div className="flex items-center space-x-4 pt-6 border-t border-slate-600">
                <div className="flex items-center space-x-2">
                  <Button
                    variant="outline"
                    onClick={() => updateQuantity(selectedProduct.id, getQuantity(selectedProduct.id) - 1)}
                    disabled={getQuantity(selectedProduct.id) <= 1}
                    className="bg-slate-700 border-slate-600"
                  >
                    <Minus className="w-4 h-4" />
                  </Button>
                  <span className="text-xl font-medium text-white px-4">
                    {getQuantity(selectedProduct.id)}
                  </span>
                  <Button
                    variant="outline"
                    onClick={() => updateQuantity(selectedProduct.id, getQuantity(selectedProduct.id) + 1)}
                    disabled={getQuantity(selectedProduct.id) >= selectedProduct.quantity}
                    className="bg-slate-700 border-slate-600"
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
                
                <Button
                  onClick={() => handleAddToCart(selectedProduct, getQuantity(selectedProduct.id))}
                  disabled={!selectedProduct.inStock}
                  size="lg"
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white text-lg"
                >
                  <ShoppingCart className="w-5 h-5 mr-2" />
                  Add to Cart - ${(selectedProduct.price * getQuantity(selectedProduct.id)).toFixed(2)}
                </Button>
              </div>

              {/* Trust Badges */}
              <div className="flex justify-center space-x-8 pt-6 border-t border-slate-600">
                <div className="flex items-center space-x-2 text-green-400">
                  <Truck className="w-5 h-5" />
                  <span className="text-sm">Free Shipping Over $75</span>
                </div>
                <div className="flex items-center space-x-2 text-blue-400">
                  <Shield className="w-5 h-5" />
                  <span className="text-sm">30-Day Warranty</span>
                </div>
                <div className="flex items-center space-x-2 text-purple-400">
                  <Zap className="w-5 h-5" />
                  <span className="text-sm">Setup Support</span>
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
      <div className="max-w-6xl mx-auto">
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
              <p className="text-xl text-blue-200">Premium Streaming Devices & Accessories</p>
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
              Cart ({getItemCount()})
            </Button>
          </div>
        </div>

        {/* Wix Integration Test - Hidden, just for testing */}
        {false && (
          <div className="mb-8">
            <WixVerification />
          </div>
        )}

        {/* Featured Products */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-white mb-4">Featured Deals</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {getFeaturedProducts().slice(0, 3).map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </div>

        {/* Categories Tabs */}
        <Tabs defaultValue="android-devices" className="w-full">
          <TabsList className="grid w-full grid-cols-4 bg-slate-800 border-slate-700 mb-8">
            <TabsTrigger value="android-devices" className="text-white data-[state=active]:bg-blue-600">
              Android Devices
            </TabsTrigger>
            <TabsTrigger value="fire-tv" className="text-white data-[state=active]:bg-orange-600">
              Fire TV
            </TabsTrigger>
            <TabsTrigger value="streaming-boxes" className="text-white data-[state=active]:bg-green-600">
              Premium Boxes
            </TabsTrigger>
            <TabsTrigger value="accessories" className="text-white data-[state=active]:bg-purple-600">
              Accessories
            </TabsTrigger>
          </TabsList>

          <TabsContent value="android-devices">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {getProductsByCategory('android-devices').map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          </TabsContent>

          <TabsContent value="fire-tv">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {getProductsByCategory('fire-tv').map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          </TabsContent>

          <TabsContent value="streaming-boxes">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {getProductsByCategory('streaming-boxes').map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          </TabsContent>

          <TabsContent value="accessories">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {getProductsByCategory('accessories').map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default MediaStore;