import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Verify API key for external access
    const apiKey = req.headers.get('x-api-key')
    const expectedKey = Deno.env.get('KNOWLEDGE_API_KEY')
    
    if (!apiKey || apiKey !== expectedKey) {
      return new Response(JSON.stringify({ error: 'Invalid API key' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { method } = req

    if (method === 'POST') {
      // Add new knowledge document
      const { title, description, content, category, source_url } = await req.json()

      if (!title || !content) {
        throw new Error('Title and content are required')
      }

      // Store content as text file in storage
      const fileName = `external/${Date.now()}-${title.replace(/[^a-zA-Z0-9]/g, '-')}.txt`
      
      const { data: fileData, error: fileError } = await supabase.storage
        .from('knowledge-base')
        .upload(fileName, content, {
          contentType: 'text/plain'
        })

      if (fileError) throw fileError

      // Create document record
      const { data: docData, error: docError } = await supabase
        .from('knowledge_documents')
        .insert({
          title,
          description: description || `External knowledge from ${source_url || 'API'}`,
          file_path: fileData.path,
          file_type: 'text/plain',
          content_preview: content.substring(0, 1000),
          category: category || 'general',
          is_active: true
        })
        .select()
        .single()

      if (docError) throw docError

      console.log(`Knowledge document added: ${title}`)

      return new Response(JSON.stringify({ 
        success: true, 
        document: docData,
        message: 'Knowledge document added successfully'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (method === 'PUT') {
      // Update existing knowledge document by title
      const { title, content, description, category } = await req.json()

      if (!title) {
        throw new Error('Title is required for updates')
      }

      // Find existing document
      const { data: existingDoc, error: findError } = await supabase
        .from('knowledge_documents')
        .select('*')
        .eq('title', title)
        .maybeSingle()

      if (findError) throw findError

      if (existingDoc) {
        // Update existing file content
        const { error: updateError } = await supabase.storage
          .from('knowledge-base')
          .update(existingDoc.file_path, content, {
            contentType: 'text/plain'
          })

        if (updateError) throw updateError

        // Update document record
        const { data: updatedDoc, error: docError } = await supabase
          .from('knowledge_documents')
          .update({
            description: description || existingDoc.description,
            category: category || existingDoc.category,
            content_preview: content.substring(0, 1000),
            updated_at: new Date().toISOString()
          })
          .eq('id', existingDoc.id)
          .select()
          .single()

        if (docError) throw docError

        console.log(`Knowledge document updated: ${title}`)

        return new Response(JSON.stringify({ 
          success: true, 
          document: updatedDoc,
          message: 'Knowledge document updated successfully'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      } else {
        // Create new document if not found
        const fileName = `external/${Date.now()}-${title.replace(/[^a-zA-Z0-9]/g, '-')}.txt`
        
        const { data: fileData, error: fileError } = await supabase.storage
          .from('knowledge-base')
          .upload(fileName, content, {
            contentType: 'text/plain'
          })

        if (fileError) throw fileError

        const { data: docData, error: docError } = await supabase
          .from('knowledge_documents')
          .insert({
            title,
            description: description || 'External knowledge via API',
            file_path: fileData.path,
            file_type: 'text/plain',
            content_preview: content.substring(0, 1000),
            category: category || 'general',
            is_active: true
          })
          .select()
          .single()

        if (docError) throw docError

        return new Response(JSON.stringify({ 
          success: true, 
          document: docData,
          message: 'Knowledge document created successfully'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
    }

    if (method === 'DELETE') {
      // Delete knowledge document
      const { title } = await req.json()

      if (!title) {
        throw new Error('Title is required for deletion')
      }

      const { data: existingDoc, error: findError } = await supabase
        .from('knowledge_documents')
        .select('*')
        .eq('title', title)
        .maybeSingle()

      if (findError) throw findError

      if (existingDoc) {
        // Delete file from storage
        const { error: storageError } = await supabase.storage
          .from('knowledge-base')
          .remove([existingDoc.file_path])

        if (storageError) console.error('Storage deletion error:', storageError)

        // Delete document record
        const { error: dbError } = await supabase
          .from('knowledge_documents')
          .delete()
          .eq('id', existingDoc.id)

        if (dbError) throw dbError

        console.log(`Knowledge document deleted: ${title}`)

        return new Response(JSON.stringify({ 
          success: true,
          message: 'Knowledge document deleted successfully'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      } else {
        return new Response(JSON.stringify({ 
          success: false,
          message: 'Document not found'
        }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
    }

    if (method === 'GET') {
      // List all knowledge documents
      const { data: docs, error } = await supabase
        .from('knowledge_documents')
        .select('title, description, category, is_active, created_at, updated_at')
        .order('updated_at', { ascending: false })

      if (error) throw error

      return new Response(JSON.stringify({ 
        success: true, 
        documents: docs,
        count: docs.length
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Error:', error)
    return new Response(JSON.stringify({ 
      error: error.message,
      success: false
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})