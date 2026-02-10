export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "12.2.3 (519615d)"
  }
  public: {
    Tables: {
      ai_conversations: {
        Row: {
          created_at: string
          id: string
          last_message_at: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_message_at?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_message_at?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ai_image_usage: {
        Row: {
          cost_credits: number
          created_at: string
          id: string
          image_url: string | null
          prompt: string
          user_id: string
        }
        Insert: {
          cost_credits?: number
          created_at?: string
          id?: string
          image_url?: string | null
          prompt: string
          user_id: string
        }
        Update: {
          cost_credits?: number
          created_at?: string
          id?: string
          image_url?: string | null
          prompt?: string
          user_id?: string
        }
        Relationships: []
      }
      ai_messages: {
        Row: {
          conversation_id: string
          created_at: string
          id: string
          message: string
          sender_type: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          id?: string
          message: string
          sender_type: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          id?: string
          message?: string
          sender_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "ai_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      apps: {
        Row: {
          category: string
          created_at: string
          description: string
          download_url: string | null
          icon_url: string | null
          id: string
          is_featured: boolean | null
          is_installed: boolean | null
          name: string
          package_name: string | null
          size: string
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          description: string
          download_url?: string | null
          icon_url?: string | null
          id?: string
          is_featured?: boolean | null
          is_installed?: boolean | null
          name: string
          package_name?: string | null
          size: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string
          download_url?: string | null
          icon_url?: string | null
          id?: string
          is_featured?: boolean | null
          is_installed?: boolean | null
          name?: string
          package_name?: string | null
          size?: string
          updated_at?: string
        }
        Relationships: []
      }
      community_messages: {
        Row: {
          created_at: string
          id: string
          is_pinned: boolean | null
          message: string
          reply_to: string | null
          room_id: string | null
          updated_at: string
          user_id: string
          username: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_pinned?: boolean | null
          message: string
          reply_to?: string | null
          room_id?: string | null
          updated_at?: string
          user_id: string
          username?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_pinned?: boolean | null
          message?: string
          reply_to?: string | null
          room_id?: string | null
          updated_at?: string
          user_id?: string
          username?: string | null
        }
        Relationships: []
      }
      credit_packages: {
        Row: {
          created_at: string
          credits: number
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          price: number
        }
        Insert: {
          created_at?: string
          credits: number
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          price: number
        }
        Update: {
          created_at?: string
          credits?: number
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          price?: number
        }
        Relationships: []
      }
      credit_transactions: {
        Row: {
          amount: number
          created_at: string
          description: string
          id: string
          paypal_transaction_id: string | null
          transaction_type: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          description: string
          id?: string
          paypal_transaction_id?: string | null
          transaction_type: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string
          id?: string
          paypal_transaction_id?: string | null
          transaction_type?: string
          user_id?: string
        }
        Relationships: []
      }
      knowledge_documents: {
        Row: {
          category: string | null
          content_preview: string | null
          created_at: string
          description: string | null
          file_path: string
          file_type: string
          id: string
          is_active: boolean
          title: string
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          category?: string | null
          content_preview?: string | null
          created_at?: string
          description?: string | null
          file_path: string
          file_type: string
          id?: string
          is_active?: boolean
          title: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          category?: string | null
          content_preview?: string | null
          created_at?: string
          description?: string | null
          file_path?: string
          file_type?: string
          id?: string
          is_active?: boolean
          title?: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: []
      }
      media_assets: {
        Row: {
          asset_type: Database["public"]["Enums"]["asset_type"]
          created_at: string
          description: string | null
          file_path: string
          id: string
          is_active: boolean
          name: string
          rotation_order: number | null
          section: string
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          asset_type?: Database["public"]["Enums"]["asset_type"]
          created_at?: string
          description?: string | null
          file_path: string
          id?: string
          is_active?: boolean
          name: string
          rotation_order?: number | null
          section?: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          asset_type?: Database["public"]["Enums"]["asset_type"]
          created_at?: string
          description?: string | null
          file_path?: string
          id?: string
          is_active?: boolean
          name?: string
          rotation_order?: number | null
          section?: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          credits: number
          email: string | null
          full_name: string | null
          id: string
          total_spent: number
          updated_at: string
          user_id: string
          username: string | null
          wix_account_id: string | null
        }
        Insert: {
          created_at?: string
          credits?: number
          email?: string | null
          full_name?: string | null
          id?: string
          total_spent?: number
          updated_at?: string
          user_id: string
          username?: string | null
          wix_account_id?: string | null
        }
        Update: {
          created_at?: string
          credits?: number
          email?: string | null
          full_name?: string | null
          id?: string
          total_spent?: number
          updated_at?: string
          user_id?: string
          username?: string | null
          wix_account_id?: string | null
        }
        Relationships: []
      }
      qr_login_sessions: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          is_used: boolean
          token: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: string
          is_used?: boolean
          token: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          is_used?: boolean
          token?: string
          user_id?: string | null
        }
        Relationships: []
      }
      support_messages: {
        Row: {
          created_at: string
          id: string
          message: string
          sender_type: string
          ticket_id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          sender_type: string
          ticket_id: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          sender_type?: string
          ticket_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "support_messages_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          admin_has_unread: boolean
          created_at: string
          id: string
          last_message_at: string
          priority: string
          status: string
          subject: string
          updated_at: string
          user_has_unread: boolean
          user_id: string
        }
        Insert: {
          admin_has_unread?: boolean
          created_at?: string
          id?: string
          last_message_at?: string
          priority?: string
          status?: string
          subject: string
          updated_at?: string
          user_has_unread?: boolean
          user_id: string
        }
        Update: {
          admin_has_unread?: boolean
          created_at?: string
          id?: string
          last_message_at?: string
          priority?: string
          status?: string
          subject?: string
          updated_at?: string
          user_has_unread?: boolean
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_subscriptions: {
        Row: {
          connection_count: number
          created_at: string
          id: string
          monthly_price: number
          next_billing_date: string | null
          paypal_subscription_id: string | null
          plan_name: string
          service_type: Database["public"]["Enums"]["service_type"]
          status: Database["public"]["Enums"]["subscription_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          connection_count?: number
          created_at?: string
          id?: string
          monthly_price: number
          next_billing_date?: string | null
          paypal_subscription_id?: string | null
          plan_name: string
          service_type: Database["public"]["Enums"]["service_type"]
          status?: Database["public"]["Enums"]["subscription_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          connection_count?: number
          created_at?: string
          id?: string
          monthly_price?: number
          next_billing_date?: string | null
          paypal_subscription_id?: string | null
          plan_name?: string
          service_type?: Database["public"]["Enums"]["service_type"]
          status?: Database["public"]["Enums"]["subscription_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_profile_owner: { Args: { profile_user_id: string }; Returns: boolean }
      update_user_credits: {
        Args: {
          p_amount: number
          p_description: string
          p_paypal_transaction_id?: string
          p_transaction_type: string
          p_user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
      asset_type: "background" | "icon" | "logo" | "other"
      service_type: "dreamstreams" | "plex"
      subscription_status: "active" | "inactive" | "pending" | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
      asset_type: ["background", "icon", "logo", "other"],
      service_type: ["dreamstreams", "plex"],
      subscription_status: ["active", "inactive", "pending", "cancelled"],
    },
  },
} as const
