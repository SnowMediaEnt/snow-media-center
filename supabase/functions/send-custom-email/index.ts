// Email through the shared Resend account.
//
// Staff (has_role admin) can send anything: { to, subject, html, fromName } or
// a template { to, type, data }. Everyone else is a customer telling support
// about a ticket, so for them:
//   - the recipient must be a support inbox: SUPPORT_EMAIL (default
//     support@snowmediaent.com) or a tenant's configured support_email;
//   - the body is plain text ({ subject, message }, or the text of the html
//     older apps send), escaped here and signed with the verified account;
//   - templates are refused, and sends are limited per account and in total.
// Without this any signed-up account could send any HTML, under any sender
// name, to any address, and use up the Resend quota PIN resets depend on.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Resend } from 'npm:resend@4.0.0';
import { escapeHtml, htmlToText, throttle, type ThrottleDb } from '../_shared/requestGuard.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const resend = new Resend(Deno.env.get('RESEND_API_KEY'));

const SUPPORT_EMAIL = (Deno.env.get('SUPPORT_EMAIL') || 'support@snowmediaent.com').trim().toLowerCase();
const CUSTOMER_PER_HOUR = 10;
const CUSTOMERS_ALL_PER_HOUR = 150;
const HOUR_MS = 60 * 60 * 1000;

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

// The slice of the service-role client isSupportInbox uses, typed by shape
// (see player-favorites for why not ReturnType<typeof createClient>).
interface InboxDb {
  from: (table: 'tenant_settings') => {
    select: (cols: string) => {
      ilike: (col: string, v: string) => {
        limit: (n: number) => PromiseLike<{ data: Array<{ support_email: string | null }> | null }>;
      };
    };
  };
}

/** Snow Media's inbox, or the support address a tenant has set up. */
async function isSupportInbox(admin: InboxDb, to: string): Promise<boolean> {
  if (to === SUPPORT_EMAIL) return true;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return false;
  const { data } = await admin
    .from('tenant_settings')
    .select('support_email')
    .ilike('support_email', to.replace(/[\\%_]/g, (c) => `\\${c}`))
    .limit(5);
  return (data ?? []).some((r) => (r.support_email ?? '').trim().toLowerCase() === to);
}

/** A display name only: letters, digits and a little punctuation. */
const senderName = (v: unknown): string => {
  const n = String(v ?? '').replace(/[^\p{L}\p{N} .'&-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return n || 'Snow Media Center';
};

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
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      console.error('Auth error:', userError);
      return new Response(JSON.stringify({ error: 'Invalid token' }), { 
        status: 401, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    const userId = user.id;

    // Check if Resend API key is configured
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    if (!resendApiKey) {
      console.error('Resend API key not configured');
      return new Response(
        JSON.stringify({ error: 'Email service not configured. Please set RESEND_API_KEY.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    const { data: isStaff } = await admin.rpc('has_role', { _user_id: userId, _role: 'admin' });

    const body = await req.json().catch(() => ({}));
    
    let emailSubject: string;
    let emailHtml: string;
    let emailTo: string;
    let fromName: string = 'Snow Media Center';
    
    if (isStaff !== true) {
      // A customer: only to a support inbox, only text, only so often.
      if (body.type) return reply({ error: 'Template emails are sent by Snow Media only.' }, 403);
      emailTo = (typeof body.to === 'string' ? body.to.trim().toLowerCase() : '') || SUPPORT_EMAIL;
      if (!(await isSupportInbox(admin as unknown as InboxDb, emailTo))) {
        return reply({ error: 'Messages can only go to a support inbox.' }, 403);
      }
      emailSubject = String(body.subject ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
      const text = (typeof body.message === 'string' ? body.message : htmlToText(String(body.html ?? ''))).trim().slice(0, 5000);
      if (!emailSubject || !text) return reply({ error: 'subject and message required' }, 400);
      const db = admin as unknown as ThrottleDb;
      if (!(await throttle(db, `sce:${userId}`, CUSTOMER_PER_HOUR, HOUR_MS))
          || !(await throttle(db, 'sce:all', CUSTOMERS_ALL_PER_HOUR, HOUR_MS))) {
        return reply({ error: 'rate_limited' }, 429);
      }
      fromName = senderName(body.fromName);
      emailHtml = `
        <p style="margin:0 0 12px;color:#666;font-size:12px;">Sent from the app by the signed-in account <strong>${escapeHtml(user.email || userId)}</strong>.</p>
        <div style="padding:12px;background:#f5f5f5;border-radius:6px;white-space:pre-wrap;">${escapeHtml(text)}</div>
      `;
      console.log('Sending customer email to a support inbox');
    } else if (body.subject && body.html) {
      // Custom email with subject and HTML directly provided
      emailTo = body.to;
      emailSubject = body.subject;
      emailHtml = body.html;
      fromName = body.fromName || 'Snow Media Center';
      console.log('Sending custom email');
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
      console.log('Sending template email:', body.type);
    } else {
      return new Response(
        JSON.stringify({ error: 'Invalid email request. Provide either {to, subject, html} or {to, type, data}' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log('Sending email via Resend...');
    
    // Send email using Resend
    const { data: emailData, error: emailError } = await resend.emails.send({
      from: `${fromName} <onboarding@resend.dev>`,
      to: [emailTo],
      subject: emailSubject,
      html: emailHtml,
    });

    if (emailError) {
      console.error('Resend error:', emailError);
      return new Response(
        JSON.stringify({ 
          error: 'Failed to send email',
          message: emailError.message
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Email sent successfully:', emailData);
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Email sent successfully',
        id: emailData?.id,
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