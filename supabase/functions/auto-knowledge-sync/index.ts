import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    console.log('Starting automatic knowledge sync...')

    // Configuration for external sources
    const sources = [
      {
        name: 'GitHub Repository',
        type: 'github',
        url: 'https://api.github.com/repos/YOUR_USERNAME/snow-media-center/contents/',
        headers: {
          'Authorization': `token ${Deno.env.get('GITHUB_TOKEN')}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      },
      {
        name: 'Google Drive Folder',
        type: 'gdrive',
        url: 'https://www.googleapis.com/drive/v3/files',
        headers: {
          'Authorization': `Bearer ${Deno.env.get('GOOGLE_DRIVE_TOKEN')}`
        }
      },
      {
        name: 'External API',
        type: 'api',
        url: Deno.env.get('EXTERNAL_KNOWLEDGE_URL'),
        headers: {
          'Authorization': `Bearer ${Deno.env.get('EXTERNAL_API_TOKEN')}`
        }
      }
    ]

    const results = []

    for (const source of sources) {
      try {
        if (!source.url) continue

        console.log(`Syncing from ${source.name}...`)

        if (source.type === 'github') {
          const result = await syncFromGitHub(source, supabase)
          results.push({ source: source.name, ...result })
        } else if (source.type === 'gdrive') {
          const result = await syncFromGoogleDrive(source, supabase)
          results.push({ source: source.name, ...result })
        } else if (source.type === 'api') {
          const result = await syncFromAPI(source, supabase)
          results.push({ source: source.name, ...result })
        }

      } catch (error) {
        console.error(`Error syncing from ${source.name}:`, error)
        results.push({ 
          source: source.name, 
          success: false, 
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    return new Response(JSON.stringify({ 
      success: true,
      sync_results: results,
      timestamp: new Date().toISOString()
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Sync error:', error)
    return new Response(JSON.stringify({ 
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

async function syncFromGitHub(source: any, supabase: any) {
  try {
    const response = await fetch(source.url, { headers: source.headers })
    const files = await response.json()

    let synced = 0
    let errors = 0

    for (const file of files) {
      if (file.type === 'file' && (file.name.endsWith('.md') || file.name.endsWith('.txt'))) {
        try {
          // Get file content
          const contentResponse = await fetch(file.download_url)
          const content = await contentResponse.text()

          // Store in knowledge base
          await upsertKnowledgeDocument(supabase, {
            title: file.name.replace(/\.(md|txt)$/, ''),
            content,
            category: 'github-sync',
            description: `Auto-synced from GitHub: ${file.path}`,
            source_url: file.html_url
          })

          synced++
        } catch (error) {
          console.error(`Error processing file ${file.name}:`, error)
          errors++
        }
      }
    }

    return { success: true, synced, errors }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function syncFromGoogleDrive(source: any, supabase: any) {
  try {
    // Query for text files in specific folder
    const folderId = Deno.env.get('GDRIVE_FOLDER_ID')
    const query = `parents='${folderId}' and (mimeType='text/plain' or mimeType='text/markdown')`
    
    const response = await fetch(`${source.url}?q=${encodeURIComponent(query)}`, {
      headers: source.headers
    })
    
    const data = await response.json()
    let synced = 0
    let errors = 0

    for (const file of data.files || []) {
      try {
        // Get file content
        const contentResponse = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
          headers: source.headers
        })
        const content = await contentResponse.text()

        await upsertKnowledgeDocument(supabase, {
          title: file.name.replace(/\.(txt|md)$/, ''),
          content,
          category: 'gdrive-sync',
          description: `Auto-synced from Google Drive: ${file.name}`,
          source_url: `https://drive.google.com/file/d/${file.id}/view`
        })

        synced++
      } catch (error) {
        console.error(`Error processing file ${file.name}:`, error)
        errors++
      }
    }

    return { success: true, synced, errors }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function syncFromAPI(source: any, supabase: any) {
  try {
    const response = await fetch(source.url, { headers: source.headers })
    const data = await response.json()

    let synced = 0
    let errors = 0

    // Expecting API to return array of knowledge documents
    const documents = Array.isArray(data) ? data : data.documents || []

    for (const doc of documents) {
      try {
        await upsertKnowledgeDocument(supabase, {
          title: doc.title,
          content: doc.content,
          category: doc.category || 'api-sync',
          description: doc.description || `Auto-synced from external API`,
          source_url: doc.url
        })

        synced++
      } catch (error) {
        console.error(`Error processing document ${doc.title}:`, error)
        errors++
      }
    }

    return { success: true, synced, errors }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function upsertKnowledgeDocument(supabase: any, doc: any) {
  // Check if document exists
  const { data: existing } = await supabase
    .from('knowledge_documents')
    .select('*')
    .eq('title', doc.title)
    .maybeSingle()

  const fileName = `auto-sync/${Date.now()}-${doc.title.replace(/[^a-zA-Z0-9]/g, '-')}.txt`

  if (existing) {
    // Update existing document
    const { error: storageError } = await supabase.storage
      .from('knowledge-base')
      .update(existing.file_path, doc.content, {
        contentType: 'text/plain'
      })

    if (storageError) throw storageError

    const { error: dbError } = await supabase
      .from('knowledge_documents')
      .update({
        description: doc.description,
        category: doc.category,
        content_preview: doc.content.substring(0, 1000),
        updated_at: new Date().toISOString()
      })
      .eq('id', existing.id)

    if (dbError) throw dbError
  } else {
    // Create new document
    const { data: fileData, error: fileError } = await supabase.storage
      .from('knowledge-base')
      .upload(fileName, doc.content, {
        contentType: 'text/plain'
      })

    if (fileError) throw fileError

    const { error: dbError } = await supabase
      .from('knowledge_documents')
      .insert({
        title: doc.title,
        description: doc.description,
        file_path: fileData.path,
        file_type: 'text/plain',
        content_preview: doc.content.substring(0, 1000),
        category: doc.category,
        is_active: true
      })

    if (dbError) throw dbError
  }
}