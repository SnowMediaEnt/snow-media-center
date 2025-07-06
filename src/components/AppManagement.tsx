import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Edit, Trash2, Save, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useApps, App } from '@/hooks/useApps';
import { toast } from 'sonner';

interface AppFormData {
  name: string;
  description: string;
  size: string;
  category: string;
  icon_url: string;
  download_url: string;
  is_installed: boolean;
  is_featured: boolean;
}

const AppManagement = () => {
  const { apps, loading, refetch } = useApps();
  const [showForm, setShowForm] = useState(false);
  const [editingApp, setEditingApp] = useState<App | null>(null);
  const [formData, setFormData] = useState<AppFormData>({
    name: '',
    description: '',
    size: '',
    category: 'Main',
    icon_url: '',
    download_url: '',
    is_installed: false,
    is_featured: false,
  });

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      size: '',
      category: 'Main',
      icon_url: '',
      download_url: '',
      is_installed: false,
      is_featured: false,
    });
    setEditingApp(null);
    setShowForm(false);
  };

  const handleEdit = (app: App) => {
    setEditingApp(app);
    setFormData({
      name: app.name,
      description: app.description,
      size: app.size,
      category: app.category,
      icon_url: app.icon_url || '',
      download_url: app.download_url || '',
      is_installed: app.is_installed,
      is_featured: app.is_featured,
    });
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      if (editingApp) {
        // Update existing app
        const { error } = await supabase
          .from('apps')
          .update(formData)
          .eq('id', editingApp.id);
        
        if (error) throw error;
        toast.success('App updated successfully!');
      } else {
        // Create new app
        const { error } = await supabase
          .from('apps')
          .insert([formData]);
        
        if (error) throw error;
        toast.success('App created successfully!');
      }
      
      resetForm();
      refetch();
    } catch (error) {
      toast.error(`Error ${editingApp ? 'updating' : 'creating'} app: ${error.message}`);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this app?')) return;
    
    try {
      const { error } = await supabase
        .from('apps')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
      toast.success('App deleted successfully!');
      refetch();
    } catch (error) {
      toast.error(`Error deleting app: ${error.message}`);
    }
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold text-white">App Management</h1>
        <Button 
          onClick={() => setShowForm(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add New App
        </Button>
      </div>

      {/* Form Modal */}
      {showForm && (
        <Card className="mb-8 p-6 bg-slate-800 border-slate-700">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-white">
              {editingApp ? 'Edit App' : 'Add New App'}
            </h2>
            <Button 
              onClick={resetForm}
              variant="ghost" 
              size="sm"
              className="text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="name" className="text-white">App Name</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                  className="bg-slate-700 border-slate-600 text-white"
                />
              </div>
              <div>
                <Label htmlFor="size" className="text-white">Size</Label>
                <Input
                  id="size"
                  value={formData.size}
                  onChange={(e) => setFormData({ ...formData, size: e.target.value })}
                  placeholder="e.g., 45.2 MB"
                  required
                  className="bg-slate-700 border-slate-600 text-white"
                />
              </div>
            </div>
            
            <div>
              <Label htmlFor="description" className="text-white">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                required
                className="bg-slate-700 border-slate-600 text-white"
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="category" className="text-white">Category</Label>
                <Select value={formData.category} onValueChange={(value) => setFormData({ ...formData, category: value })}>
                  <SelectTrigger className="bg-slate-700 border-slate-600 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Main">Main</SelectItem>
                    <SelectItem value="Media">Media</SelectItem>
                    <SelectItem value="IPTV">IPTV</SelectItem>
                    <SelectItem value="Utility">Utility</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            <div>
              <Label htmlFor="icon_url" className="text-white">Icon URL</Label>
              <Input
                id="icon_url"
                value={formData.icon_url}
                onChange={(e) => setFormData({ ...formData, icon_url: e.target.value })}
                placeholder="/icons/app-icon.png"
                className="bg-slate-700 border-slate-600 text-white"
              />
            </div>
            
            <div>
              <Label htmlFor="download_url" className="text-white">Download URL</Label>
              <Input
                id="download_url"
                value={formData.download_url}
                onChange={(e) => setFormData({ ...formData, download_url: e.target.value })}
                placeholder="104.168.147.178/apps/app-name.apk"
                className="bg-slate-700 border-slate-600 text-white"
              />
            </div>
            
            <div className="flex gap-6">
              <div className="flex items-center space-x-2">
                <Switch
                  id="is_installed"
                  checked={formData.is_installed}
                  onCheckedChange={(checked) => setFormData({ ...formData, is_installed: checked })}
                />
                <Label htmlFor="is_installed" className="text-white">Installed</Label>
              </div>
              
              <div className="flex items-center space-x-2">
                <Switch
                  id="is_featured"
                  checked={formData.is_featured}
                  onCheckedChange={(checked) => setFormData({ ...formData, is_featured: checked })}
                />
                <Label htmlFor="is_featured" className="text-white">Featured</Label>
              </div>
            </div>
            
            <div className="flex gap-4 pt-4">
              <Button type="submit" className="bg-green-600 hover:bg-green-700 text-white">
                <Save className="w-4 h-4 mr-2" />
                {editingApp ? 'Update App' : 'Create App'}
              </Button>
              <Button type="button" onClick={resetForm} variant="outline" className="border-slate-600 text-slate-300 hover:text-white">
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* Apps List */}
      <div className="grid gap-4">
        {loading ? (
          <p className="text-white text-center">Loading apps...</p>
        ) : (
          apps.map((app) => (
            <Card key={app.id} className="bg-slate-800 border-slate-700 p-4">
              <div className="flex justify-between items-start">
                <div className="flex gap-4">
                  <img 
                    src={app.icon_url || '/placeholder.svg'} 
                    alt={app.name}
                    className="w-16 h-16 rounded-lg bg-white p-2"
                  />
                  <div>
                    <h3 className="text-lg font-bold text-white">{app.name}</h3>
                    <p className="text-slate-400 text-sm">{app.description}</p>
                    <div className="flex gap-4 mt-2 text-xs text-slate-500">
                      <span>Category: {app.category}</span>
                      <span>Size: {app.size}</span>
                      {app.is_installed && <span className="text-green-400">Installed</span>}
                      {app.is_featured && <span className="text-blue-400">Featured</span>}
                    </div>
                  </div>
                </div>
                
                <div className="flex gap-2">
                  <Button 
                    onClick={() => handleEdit(app)}
                    size="sm"
                    variant="outline"
                    className="border-slate-600 text-slate-300 hover:text-white"
                  >
                    <Edit className="w-4 h-4" />
                  </Button>
                  <Button 
                    onClick={() => handleDelete(app.id)}
                    size="sm"
                    variant="outline"
                    className="border-red-600 text-red-400 hover:text-red-300 hover:border-red-500"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
};

export default AppManagement;