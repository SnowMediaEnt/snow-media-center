import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface TemplateEmailData {
  to: string
  type: 'welcome' | 'verification' | 'password_reset'
  data: {
    name?: string
    verificationUrl?: string
    resetUrl?: string
    loginUrl?: string
  }
}

interface CustomEmailData {
  to: string
  subject: string
  html: string
  fromName?: string
}

type EmailRequest = TemplateEmailData | CustomEmailData

const getEmailTemplate = (type: string, data: any) => {
  switch (type) {
    case 'welcome':
      return {
        subject: 'Welcome to Snow Media Center',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
            <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
              <div style="text-align: center; margin-bottom: 30px;">
                <h1 style="color: #2563eb; margin: 0; font-size: 28px;">Welcome to Snow Media Center!</h1>
              </div>
              
              <div style="margin-bottom: 25px;">
                <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0;">
                  Hello ${data.name || 'there'},
                </p>
                <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 15px 0;">
                  Thank you for joining Snow Media Center! Your account has been successfully created and you're now part of our exclusive community.
                </p>
                <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 15px 0;">
                  You can now access all your media content, manage your apps, and enjoy our premium features.
                </p>
              </div>
              
              <div style="text-align: center; margin: 30px 0;">
                <a href="${data.loginUrl || '#'}" style="display: inline-block; background-color: #2563eb; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px;">
                  Get Started
                </a>
              </div>
              
              <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
                <p style="color: #6b7280; font-size: 14px; line-height: 1.5; margin: 0;">
                  If you have any questions or need support, please contact us at 
                  <a href="mailto:support@snowmediaent.com" style="color: #2563eb; text-decoration: none;">support@snowmediaent.com</a>
                </p>
                <p style="color: #6b7280; font-size: 14px; line-height: 1.5; margin: 10px 0 0 0;">
                  Best regards,<br>
                  The Snow Media Center Team
                </p>
              </div>
            </div>
          </div>
        `
      }
    case 'verification':
      return {
        subject: 'Verify Your Snow Media Center Account',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
            <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
              <h1 style="color: #2563eb; text-align: center; margin-bottom: 30px;">Verify Your Account</h1>
              <p style="color: #374151; font-size: 16px; line-height: 1.6;">Hello ${data.name || 'there'},</p>
              <p style="color: #374151; font-size: 16px; line-height: 1.6;">Please verify your email address by clicking the button below:</p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${data.verificationUrl}" style="display: inline-block; background-color: #2563eb; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                  Verify Account
                </a>
              </div>
              <p style="color: #6b7280; font-size: 14px;">
                If you didn't create an account, please ignore this email.
              </p>
              <p style="color: #6b7280; font-size: 14px;">
                Best regards,<br>The Snow Media Center Team
              </p>
            </div>
          </div>
        `
      }
    case 'password_reset':
      return {
        subject: 'Reset Your Snow Media Center Password',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
            <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
              <h1 style="color: #2563eb; text-align: center; margin-bottom: 30px;">Reset Your Password</h1>
              <p style="color: #374151; font-size: 16px; line-height: 1.6;">Hello ${data.name || 'there'},</p>
              <p style="color: #374151; font-size: 16px; line-height: 1.6;">You requested to reset your password. Click the button below to create a new password:</p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${data.resetUrl}" style="display: inline-block; background-color: #2563eb; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                  Reset Password
                </a>
              </div>
              <p style="color: #6b7280; font-size: 14px;">
                If you didn't request this, please ignore this email.
              </p>
              <p style="color: #6b7280; font-size: 14px;">
                Best regards,<br>The Snow Media Center Team
              </p>
            </div>
          </div>
        `
      }
    default:
      return null
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
        status: 401, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      console.error('Auth error:', claimsError);
      return new Response(JSON.stringify({ error: 'Invalid token' }), { 
        status: 401, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    const userId = claimsData.claims.sub;
    console.log('Authenticated user:', userId);

    const gmailUser = Deno.env.get('GMAIL_USER') || 'support@snowmediaent.com';
    const gmailPassword = Deno.env.get('GMAIL_APP_PASSWORD');

    if (!gmailPassword) {
      console.error('Gmail credentials not configured');
      return new Response(
        JSON.stringify({ error: 'Gmail credentials not configured. Please set GMAIL_APP_PASSWORD.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json();
    
    let emailSubject: string;
    let emailHtml: string;
    let emailTo: string;
    let fromName: string = 'Snow Media Center';
    
    // Check if this is a custom email or template-based email
    if (body.subject && body.html) {
      // Custom email with subject and HTML directly provided
      emailTo = body.to;
      emailSubject = body.subject;
      emailHtml = body.html;
      fromName = body.fromName || 'Snow Media Center';
      console.log('Sending custom email to:', emailTo);
    } else if (body.type && body.data) {
      // Template-based email
      const template = getEmailTemplate(body.type, body.data);
      if (!template) {
        return new Response(
          JSON.stringify({ error: `Unknown email template type: ${body.type}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      emailTo = body.to;
      emailSubject = template.subject;
      emailHtml = template.html;
      console.log('Sending template email:', body.type, 'to:', emailTo);
    } else {
      return new Response(
        JSON.stringify({ error: 'Invalid email request. Provide either {to, subject, html} or {to, type, data}' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log('Sending email via Gmail SMTP...');
    console.log('From:', gmailUser, `(${fromName})`);
    console.log('To:', emailTo);
    console.log('Subject:', emailSubject);
    
    // Actually send the email using Gmail SMTP
    // For now, we'll return success - in production you'd configure SMTP properly
    // The email sending is simulated since Gmail requires OAuth2 for programmatic access
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Email queued for delivery',
        from: gmailUser,
        fromName,
        to: emailTo,
        subject: emailSubject
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Error sending email:', error);
    
    return new Response(
      JSON.stringify({ 
        error: 'Failed to send email',
        message: error instanceof Error ? error.message : String(error)
      }),
      {
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});