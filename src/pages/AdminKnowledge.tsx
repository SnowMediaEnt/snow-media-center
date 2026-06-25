import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Upload, FileText, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';


const AdminKnowledge = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [uploadForm, setUploadForm] = useState({
    title: '',
    description: '',
    category: 'general',
    content: ''
  });

  const categories = [
    { value: 'general', label: 'General Information' },
    { value: 'streaming-apps', label: 'Streaming Apps' },
    { value: 'android-tv', label: 'Android TV' },
    { value: 'tutorials', label: 'Tutorials' },
    { value: 'troubleshooting', label: 'Troubleshooting' },
    { value: 'installation-guides', label: 'Installation Guides' }
  ];

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Check file type
    const allowedTypes = ['text/plain', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (!allowedTypes.includes(file.type)) {
      toast({
        title: "Invalid file type",
        description: "Please upload a TXT, PDF, DOC, or DOCX file.",
        variant: "destructive",
      });
      return;
    }

    // Read file content
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      setUploadForm(prev => ({
        ...prev,
        content: content,
        title: prev.title || file.name.replace(/\.[^/.]+$/, "")
      }));
    };
    reader.readAsText(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!uploadForm.title || !uploadForm.content) {
      toast({
        title: "Missing Information",
        description: "Please provide both title and content.",
        variant: "destructive",
      });
      return;
    }

    setUploading(true);

    try {
      // Direct insert to knowledge_documents table
      const { data, error } = await supabase
        .from('knowledge_documents')
        .insert({
          title: uploadForm.title,
          description: uploadForm.description,
          category: uploadForm.category,
          content_preview: uploadForm.content,
          file_type: 'text',
          file_path: `admin-upload/${Date.now()}-${uploadForm.title.replace(/[^a-zA-Z0-9]/g, '-')}.txt`,
          is_active: true,
          uploaded_by: user?.id
        })
        .select()
        .single();

      if (error) {
        throw new Error(error.message || 'Upload failed');
      }

      toast({
        title: "Success!",
        description: `Document "${uploadForm.title}" uploaded successfully to knowledge base.`,
      });

      // Reset form
      setUploadForm({
        title: '',
        description: '',
        category: 'general',
        content: ''
      });
    } catch (error) {
      console.error('Upload error:', error);
      toast({
        title: "Upload Failed",
        description: error instanceof Error ? error.message : 'An error occurred while uploading.',
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 text-white p-8">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">Snow Media AI Knowledge Manager</h1>
          <p className="text-xl text-blue-200">Upload documents to train the AI assistant</p>
        </div>

        <Card className="bg-gradient-to-br from-slate-800 to-slate-900 border-slate-700 p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* File Upload — web only. On Fire TV the DocumentsUI picker
                NPEs on the first D-pad arrow press and locks the device. */}
            <div className="space-y-2">
              <Label htmlFor="file" className="text-white text-lg">Upload Document</Label>
              {isNativePlatform() ? (
                <div className="border-2 border-dashed border-slate-600 rounded-lg p-6 text-center text-slate-300">
                  File upload is disabled on TV/STB builds. Open this admin page in a desktop or phone browser to upload documents.
                </div>
              ) : (
                <div className="border-2 border-dashed border-slate-600 rounded-lg p-6 text-center">
                  <input
                    id="file"
                    type="file"
                    accept=".txt,.pdf,.doc,.docx"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  <label
                    htmlFor="file"
                    className="cursor-pointer flex flex-col items-center space-y-2"
                  >
                    <Upload className="w-8 h-8 text-blue-400" />
                    <span className="text-white">Click to upload file</span>
                    <span className="text-sm text-slate-400">
                      Supported: TXT, PDF, DOC, DOCX
                    </span>
                  </label>
                </div>
              )}
            </div>

            {/* Title */}
            <div className="space-y-2">
              <Label htmlFor="title" className="text-white text-lg">Document Title</Label>
              <Input
                id="title"
                value={uploadForm.title}
                onChange={(e) => setUploadForm(prev => ({ ...prev, title: e.target.value }))}
                placeholder="e.g., How to Install Streaming Apps"
                className="bg-slate-700 border-slate-600 text-white"
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description" className="text-white text-lg">Description (Optional)</Label>
              <Input
                id="description"
                value={uploadForm.description}
                onChange={(e) => setUploadForm(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Brief description of the document"
                className="bg-slate-700 border-slate-600 text-white"
              />
            </div>

            {/* Category */}
            <div className="space-y-2">
              <Label htmlFor="category" className="text-white text-lg">Category</Label>
              <Select 
                value={uploadForm.category} 
                onValueChange={(value) => setUploadForm(prev => ({ ...prev, category: value }))}
              >
                <SelectTrigger className="bg-slate-700 border-slate-600 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-700 border-slate-600">
                  {categories.map(cat => (
                    <SelectItem key={cat.value} value={cat.value} className="text-white">
                      {cat.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Content Preview */}
            {uploadForm.content && (
              <div className="space-y-2">
                <Label className="text-white text-lg">Content Preview</Label>
                <Textarea
                  value={uploadForm.content.substring(0, 500) + (uploadForm.content.length > 500 ? '...' : '')}
                  readOnly
                  className="bg-slate-700 border-slate-600 text-white h-32"
                />
                <p className="text-sm text-slate-400">
                  {uploadForm.content.length} characters
                </p>
              </div>
            )}

            {/* Manual Content Entry */}
            <div className="space-y-2">
              <Label htmlFor="content" className="text-white text-lg">
                Or Enter Content Manually
              </Label>
              <Textarea
                id="content"
                value={uploadForm.content}
                onChange={(e) => setUploadForm(prev => ({ ...prev, content: e.target.value }))}
                placeholder="Enter your knowledge content here..."
                className="bg-slate-700 border-slate-600 text-white h-40"
              />
            </div>

            {/* Submit Button */}
            <Button
              type="submit"
              disabled={uploading || !uploadForm.title || !uploadForm.content}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white text-lg py-3"
            >
              {uploading ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <FileText className="w-5 h-5 mr-2" />
                  Upload to Knowledge Base
                </>
              )}
            </Button>
          </form>
        </Card>

        {/* Instructions */}
        <Card className="bg-gradient-to-br from-slate-800 to-slate-900 border-slate-700 p-6 mt-8">
          <h3 className="text-xl font-bold text-white mb-4">Instructions</h3>
          <div className="space-y-3 text-slate-300">
            <div className="flex items-start space-x-3">
              <CheckCircle className="w-5 h-5 text-green-400 mt-0.5" />
              <p>Upload documents that contain information you want the AI to use when helping customers</p>
            </div>
            <div className="flex items-start space-x-3">
              <CheckCircle className="w-5 h-5 text-green-400 mt-0.5" />
              <p>Choose appropriate categories to help the AI find relevant information</p>
            </div>
            <div className="flex items-start space-x-3">
              <CheckCircle className="w-5 h-5 text-green-400 mt-0.5" />
              <p>Updates are immediate - the AI will use new documents right away</p>
            </div>
            <div className="flex items-start space-x-3">
              <XCircle className="w-5 h-5 text-red-400 mt-0.5" />
              <p>Maximum file size: 10MB. For larger files, break them into smaller documents</p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};

export default AdminKnowledge;