import { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ArrowLeft, Loader2, Calendar, RefreshCw } from 'lucide-react';
import { invokeEdgeFunction } from '@/utils/edgeFunctions';
import DOMPurify from 'dompurify';

interface BlogPost {
  id: string;
  title: string;
  excerpt?: string;
  firstPublishedDate?: string;
  url?: { base?: string; path?: string };
  media?: { wixMedia?: { image?: string }; embedMedia?: { thumbnail?: { url?: string } } };
  contentText?: string;
  richContent?: any;
}

interface WixBlogProps {
  onBack: () => void;
}

// Convert Wix Ricos rich content JSON into simple HTML.
const ricosToHtml = (rc: any): string => {
  if (!rc?.nodes) return '';
  const renderNodes = (nodes: any[]): string =>
    nodes.map((n: any) => {
      const children = n.nodes ? renderNodes(n.nodes) : '';
      const text = (n.textData?.text ?? '');
      switch (n.type) {
        case 'PARAGRAPH': return `<p>${children || text}</p>`;
        case 'HEADING': {
          const lvl = Math.min(Math.max(n.headingData?.level || 2, 1), 6);
          return `<h${lvl}>${children || text}</h${lvl}>`;
        }
        case 'TEXT': return text.replace(/</g, '&lt;');
        case 'IMAGE': {
          const src = n.imageData?.image?.src?.url || n.imageData?.image?.src?.id;
          return src ? `<img src="${src}" alt="" style="max-width:100%;border-radius:8px;margin:1rem 0" />` : '';
        }
        case 'BULLETED_LIST': return `<ul>${children}</ul>`;
        case 'ORDERED_LIST': return `<ol>${children}</ol>`;
        case 'LIST_ITEM': return `<li>${children}</li>`;
        case 'BLOCKQUOTE': return `<blockquote>${children}</blockquote>`;
        case 'DIVIDER': return `<hr/>`;
        case 'LINK_PREVIEW':
        case 'LINK': {
          const href = n.linkData?.link?.url || '#';
          return `<a href="${href}" target="_blank" rel="noopener">${children || href}</a>`;
        }
        default: return children || text;
      }
    }).join('');
  return renderNodes(rc.nodes);
};

const WixBlog = ({ onBack }: WixBlogProps) => {
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<BlogPost | null>(null);

  const loadPosts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await invokeEdgeFunction<{ posts: BlogPost[] }>('wix-integration', {
        body: { action: 'get-blog-posts', limit: 30 },
        timeout: 20000,
        retries: 2,
      });
      if (err) throw err;
      setPosts(data?.posts || []);
    } catch (e: any) {
      console.error('[WixBlog] Failed to load posts:', e);
      setError(e?.message || 'Unable to load blog posts.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadPosts(); }, [loadPosts]);

  const formatDate = (d?: string) => d ? new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';

  // ---------- Detail view ----------
  if (selected) {
    const html = selected.richContent ? ricosToHtml(selected.richContent) : (selected.contentText ? `<p>${selected.contentText.replace(/\n/g, '</p><p>')}</p>` : '');
    const safe = DOMPurify.sanitize(html, { ADD_ATTR: ['target', 'rel'] });
    const cover = selected.media?.wixMedia?.image || selected.media?.embedMedia?.thumbnail?.url;
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-green-950/40 to-slate-900 p-6">
        <div className="max-w-4xl mx-auto">
          <Button
            onClick={() => setSelected(null)}
            variant="outline"
            className="mb-6 border-green-500/60 text-green-200 hover:bg-green-600 hover:text-white transition-transform duration-200 focus:scale-110 focus:shadow-[0_0_28px_rgba(74,222,128,0.6)]"
            autoFocus
          >
            <ArrowLeft className="w-5 h-5 mr-2" /> Back to Blog
          </Button>
          <Card className="bg-slate-900/80 border-green-700 p-6 md:p-8">
            {cover && <img src={cover} alt="" className="w-full max-h-72 object-cover rounded-lg mb-6" />}
            <h1 className="text-3xl md:text-4xl font-bold text-white mb-3">{selected.title}</h1>
            {selected.firstPublishedDate && (
              <div className="flex items-center text-green-300 text-sm mb-6">
                <Calendar className="w-4 h-4 mr-2" />
                {formatDate(selected.firstPublishedDate)}
              </div>
            )}
            <article
              className="prose prose-invert max-w-none text-slate-100 leading-relaxed [&_a]:text-green-400 [&_h2]:text-white [&_h3]:text-white [&_img]:rounded-lg"
              dangerouslySetInnerHTML={{ __html: safe }}
            />
          </Card>
        </div>
      </div>
    );
  }

  // ---------- List view ----------
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-green-950/40 to-slate-900 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <Button
            onClick={onBack}
            variant="outline"
            className="border-green-500/60 text-green-200 hover:bg-green-600 hover:text-white transition-transform duration-200 focus:scale-110 focus:shadow-[0_0_28px_rgba(74,222,128,0.6)]"
            autoFocus
          >
            <ArrowLeft className="w-5 h-5 mr-2" /> Back
          </Button>
          <Button
            onClick={loadPosts}
            variant="outline"
            disabled={loading}
            className="border-green-500/60 text-green-200 hover:bg-green-600 hover:text-white transition-transform duration-200 focus:scale-110 focus:shadow-[0_0_28px_rgba(74,222,128,0.6)]"
          >
            {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            Refresh
          </Button>
        </div>

        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">Community Blog</h1>
          <p className="text-green-200">Latest posts and updates from Snow Media</p>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 text-green-400 animate-spin mr-3" />
            <span className="text-green-200 text-lg">Loading blog posts...</span>
          </div>
        )}

        {!loading && error && (
          <Card className="bg-red-900/30 border-red-700 p-6 text-center">
            <p className="text-red-200">{error}</p>
          </Card>
        )}

        {!loading && !error && posts.length === 0 && (
          <Card className="bg-slate-900/60 border-green-700 p-10 text-center">
            <p className="text-green-200 text-lg">No blog posts yet. Check back soon!</p>
          </Card>
        )}

        {!loading && !error && posts.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {posts.map((post) => {
              const cover = post.media?.wixMedia?.image || post.media?.embedMedia?.thumbnail?.url;
              return (
                <button
                  key={post.id}
                  onClick={() => setSelected(post)}
                  className="text-left bg-slate-900/70 hover:bg-slate-800/70 border border-green-700/50 rounded-xl overflow-hidden transition-all duration-200 focus:outline-none focus:scale-[1.03] focus:shadow-[0_0_28px_rgba(74,222,128,0.55)] focus:border-green-400"
                >
                  {cover && <img src={cover} alt="" className="w-full h-44 object-cover" />}
                  <div className="p-5">
                    <h3 className="text-xl font-semibold text-white mb-2 line-clamp-2">{post.title}</h3>
                    {post.excerpt && (
                      <p className="text-slate-300 text-sm line-clamp-3 mb-3">{post.excerpt}</p>
                    )}
                    {post.firstPublishedDate && (
                      <div className="flex items-center text-green-300 text-xs">
                        <Calendar className="w-3.5 h-3.5 mr-1.5" />
                        {formatDate(post.firstPublishedDate)}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default WixBlog;
