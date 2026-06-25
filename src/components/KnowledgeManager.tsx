import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { ArrowLeft, Upload, Trash2, FileText, Loader2, Plus, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { isNativePlatform } from '@/utils/platform';

interface KnowledgeManagerProps {
  onBack: () => void;
}

interface KnowledgeDocument {
  id: string;
  title: string;
  description: string | null;
  file_path: string;
  file_type: string;
  content_preview: string | null;
  is_active: boolean;
  category: string;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
}

const KnowledgeManager = ({ onBack }: KnowledgeManagerProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadForm, setUploadForm] = useState({
    title: '',
    description: '',
    category: 'general'
  });

  const categories = [
    'general',
    'streaming-apps',
    'android-tv',
    'tutorials',
    'troubleshooting',
    'installation-guides'
  ];

  const fetchDocuments = async () => {
    try {
      const { data, error } = await supabase
        .from('knowledge_documents')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setDocuments(data || []);
    } catch (error) {
      console.error('Error fetching documents:', error);
      toast({
        title: "Error",
        description: "Failed to load knowledge documents",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, []);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!user) {
      toast({
        title: "Authentication required",
        description: "Please sign in to upload knowledge documents.",
        variant: "destructive",
      });
      return;
    }

    if (!uploadForm.title.trim()) {
      toast({
        title: "Title required",
        description: "Please enter a title for the document.",
        variant: "destructive",
      });
      return;
    }

    // Check file type
    const allowedTypes = ['application/pdf', 'text/plain', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (!allowedTypes.includes(file.type)) {
      toast({
        title: "Invalid file type",
        description: "Only PDF, TXT, DOC, and DOCX files are allowed.",
        variant: "destructive",
      });
      return;
    }

    try {
      setUploading(true);

      // Upload file to storage
      const fileName = `${Date.now()}-${file.name}`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('knowledge-base')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      // Read file content for preview (text files only)
      let contentPreview = null;
      if (file.type === 'text/plain' && file.size < 50000) { // Max 50KB for preview
        contentPreview = await file.text();
        contentPreview = contentPreview.substring(0, 1000); // First 1000 chars
      }

      // Save document metadata
      const { data: docData, error: docError } = await supabase
        .from('knowledge_documents')
        .insert({
          title: uploadForm.title,
          description: uploadForm.description,
          file_path: uploadData.path,
          file_type: file.type,
          content_preview: contentPreview,
          category: uploadForm.category,
          uploaded_by: user.id
        })
        .select()
        .single();

      if (docError) throw docError;

      // Update local state
      setDocuments(prev => [docData, ...prev]);

      // Reset form
      setUploadForm({ title: '', description: '', category: 'general' });
      event.target.value = '';

      toast({
        title: "Upload successful",
        description: `${uploadForm.title} has been uploaded and is now available to the AI.`,
      });

    } catch (error) {
      console.error('Upload error:', error);
      toast({
        title: "Upload failed",
        description: `Failed to upload document: ${error.message}`,
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleToggleActive = async (id: string, currentStatus: boolean) => {
    try {
      const { error } = await supabase
        .from('knowledge_documents')
        .update({ is_active: !currentStatus })
        .eq('id', id);

      if (error) throw error;

      setDocuments(prev => 
        prev.map(doc => 
          doc.id === id ? { ...doc, is_active: !currentStatus } : doc
        )
      );

      toast({
        title: currentStatus ? "Document deactivated" : "Document activated",
        description: `Document is now ${!currentStatus ? 'available to' : 'hidden from'} the AI.`,
      });

    } catch (error) {
      toast({
        title: "Failed to update",
        description: "Could not update document status.",
        variant: "destructive",
      });
    }
  };

  const handleDelete = async (id: string, filePath: string, title: string) => {
    if (!confirm(`Are you sure you want to delete "${title}"?`)) return;
    
    try {
      // Delete from storage
      const { error: storageError } = await supabase.storage
        .from('knowledge-base')
        .remove([filePath]);

      if (storageError) throw storageError;

      // Delete from database
      const { error: dbError } = await supabase
        .from('knowledge_documents')
        .delete()
        .eq('id', id);

      if (dbError) throw dbError;

      setDocuments(prev => prev.filter(doc => doc.id !== id));

      toast({
        title: "Document deleted",
        description: `${title} has been deleted successfully.`,
      });

    } catch (error) {
      toast({
        title: "Delete failed",
        description: "Failed to delete document. Please try again.",
        variant: "destructive",
      });
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen p-8 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-purple-400 mx-auto mb-4" />
          <p className="text-xl text-purple-200">Loading knowledge base...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center mb-8">
          <Button 
            onClick={onBack}
            variant="outline" 
            size="lg"
            className="mr-6 bg-purple-600 border-purple-500 text-white hover:bg-purple-700"
          >
            <ArrowLeft className="w-5 h-5 mr-2" />
            Back to Settings
          </Button>
          <div>
            <h1 className="text-4xl font-bold text-white mb-2">Knowledge Manager</h1>
            <p className="text-xl text-purple-200">Upload documents to train Snow Media AI</p>
          </div>
        </div>

        {/* Upload Section */}
        <Card className="bg-gradient-to-br from-purple-600 to-purple-800 border-purple-500 p-6 mb-8">
          <h2 className="text-2xl font-bold text-white mb-4 flex items-center">
            <Plus className="w-6 h-6 mr-2" />
            Upload New Knowledge Document
          </h2>
          <p className="text-purple-200 mb-6">
            Upload PDFs, text files, or documents containing information about snow media, streaming apps, or troubleshooting guides.
            These documents will instantly be available to the Snow Media AI to help users.
          </p>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div>
              <Label htmlFor="title" className="text-white mb-2 block">Document Title *</Label>
              <Input
                id="title"
                value={uploadForm.title}
                onChange={(e) => setUploadForm({...uploadForm, title: e.target.value})}
                placeholder="e.g., Cinema HD Installation Guide"
                className="bg-white/10 border-white/20 text-white placeholder:text-white/60"
              />
            </div>
            
            <div>
              <Label htmlFor="category" className="text-white mb-2 block">Category</Label>
              <Select value={uploadForm.category} onValueChange={(value) => setUploadForm({...uploadForm, category: value})}>
                <SelectTrigger className="bg-white/10 border-white/20 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {categories.map(cat => (
                    <SelectItem key={cat} value={cat}>
                      {cat.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <Label htmlFor="file" className="text-white mb-2 block">Upload File</Label>
              {isNativePlatform() ? (
                <div className="text-white/70 text-sm bg-white/5 border border-white/10 rounded p-3">
                  File upload is disabled on TV/STB builds (the system file picker crashes Fire TV via D-pad). Use a web browser on a desktop or phone to upload knowledge documents.
                </div>
              ) : (
                <Input
                  id="file"
                  type="file"
                  accept=".pdf,.txt,.doc,.docx"
                  onChange={handleFileUpload}
                  disabled={uploading}
                  className="bg-white/10 border-white/20 text-white file:bg-purple-600 file:text-white file:border-0 file:rounded file:px-4 file:py-2"
                />
              )}
            </div>
          </div>
          
          <div className="mb-4">
            <Label htmlFor="description" className="text-white mb-2 block">Description (Optional)</Label>
            <Textarea
              id="description"
              value={uploadForm.description}
              onChange={(e) => setUploadForm({...uploadForm, description: e.target.value})}
              placeholder="Brief description of what this document contains..."
              className="bg-white/10 border-white/20 text-white placeholder:text-white/60"
              rows={3}
            />
          </div>
          
          {uploading && (
            <div className="flex items-center text-white mt-4">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              <span>Uploading and processing document...</span>
            </div>
          )}
        </Card>

        {/* Documents List */}
        <div className="space-y-6">
          <h3 className="text-2xl font-bold text-white">Knowledge Base ({documents.length} documents)</h3>
          
          {documents.length === 0 ? (
            <Card className="bg-slate-800 border-slate-700 p-8 text-center">
              <FileText className="w-16 h-16 text-slate-400 mx-auto mb-4" />
              <h3 className="text-xl font-bold text-slate-300 mb-2">No documents uploaded yet</h3>
              <p className="text-slate-400">Upload your first knowledge document to start training the Snow Media AI.</p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {documents.map((doc) => (
                <Card key={doc.id} className={`bg-slate-800 border-slate-700 p-6 ${doc.is_active ? 'ring-2 ring-green-400' : ''}`}>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <FileText className="w-5 h-5 text-purple-400" />
                        <h4 className="text-lg font-bold text-white">{doc.title}</h4>
                        <span className="px-2 py-1 bg-purple-600 text-white text-xs rounded">
                          {doc.category.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
                        </span>
                      </div>
                      
                      {doc.description && (
                        <p className="text-slate-400 mb-3">{doc.description}</p>
                      )}
                      
                      <div className="flex items-center gap-4 text-sm text-slate-500">
                        <span>Type: {doc.file_type}</span>
                        <span>Uploaded: {new Date(doc.created_at).toLocaleDateString()}</span>
                      </div>
                      
                      {doc.content_preview && (
                        <div className="mt-3 p-3 bg-slate-900 rounded text-sm text-slate-300">
                          <p className="font-semibold mb-1">Preview:</p>
                          <p className="truncate">{doc.content_preview}...</p>
                        </div>
                      )}
                    </div>
                    
                    <div className="flex items-center gap-2 ml-4">
                      <div className="flex items-center space-x-2">
                        <Switch
                          checked={doc.is_active}
                          onCheckedChange={() => handleToggleActive(doc.id, doc.is_active)}
                        />
                        <span className="text-sm text-slate-400">
                          {doc.is_active ? (
                            <span className="text-green-400 flex items-center gap-1">
                              <Eye className="w-4 h-4" />
                              Active
                            </span>
                          ) : (
                            <span className="text-slate-400 flex items-center gap-1">
                              <EyeOff className="w-4 h-4" />
                              Inactive
                            </span>
                          )}
                        </span>
                      </div>
                      
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDelete(doc.id, doc.file_path, doc.title)}
                        className="bg-red-600 border-red-500 text-white hover:bg-red-700"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default KnowledgeManager;