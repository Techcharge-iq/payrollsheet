export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      users: {
        Row: {
          created_at: string;
          email: string | null;
          role: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          email?: string | null;
          role: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          email?: string | null;
          role?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      employees: {
        Row: {
          created_at: string;
          hourly_rate: number;
          id: number;
          id_number: string;
          name: string;
          status: string;
          trade: string;
        };
        Insert: {
          created_at?: string;
          hourly_rate?: number;
          id?: number;
          id_number?: string;
          name: string;
          status?: string;
          trade?: string;
        };
        Update: {
          created_at?: string;
          hourly_rate?: number;
          id?: number;
          id_number?: string;
          name?: string;
          status?: string;
          trade?: string;
        };
        Relationships: [];
      };
      payroll_batches: {
        Row: {
          approved_at: string | null;
          approved_by: string | null;
          created_at: string;
          foreman: string;
          id: string;
          locked_at: string | null;
          locked_by: string | null;
          month: string;
          paid_at: string | null;
          paid_by: string | null;
          site: string;
          status: "LEGACY" | "DRAFT" | "REVIEW" | "APPROVED" | "LOCKED" | "PAID";
        };
        Insert: {
          approved_at?: string | null;
          approved_by?: string | null;
          created_at?: string;
          foreman?: string;
          id?: string;
          locked_at?: string | null;
          locked_by?: string | null;
          month: string;
          paid_at?: string | null;
          paid_by?: string | null;
          site?: string;
          status?: "LEGACY" | "DRAFT" | "REVIEW" | "APPROVED" | "LOCKED" | "PAID";
        };
        Update: {
          approved_at?: string | null;
          approved_by?: string | null;
          created_at?: string;
          foreman?: string;
          id?: string;
          locked_at?: string | null;
          locked_by?: string | null;
          month?: string;
          paid_at?: string | null;
          paid_by?: string | null;
          site?: string;
          status?: "LEGACY" | "DRAFT" | "REVIEW" | "APPROVED" | "LOCKED" | "PAID";
        };
        Relationships: [];
      };
      payroll_lines: {
        Row: {
          batch_id: string;
          created_at: string;
          calculation_version: string | null;
          regular_hours: number | null;
          overtime_hours: number | null;
          regular_pay: number | null;
          overtime_pay: number | null;
          allowances: number | null;
          gross_pay: number | null;
          deductions: number | null;
          advance_recovery: number | null;
          net_pay: number | null;
          employee_id: number;
          food_deduction: number;
          foreman: string;
          hours: number;
          id: string;
          month: string;
          net_salary: number;
          new_advance: number;
          other_deduction: number;
          paid: number;
          prev_advance: number;
          rate: number;
        };
        Insert: {
          batch_id: string;
          created_at?: string;
          calculation_version?: string | null;
          regular_hours?: number | null;
          overtime_hours?: number | null;
          regular_pay?: number | null;
          overtime_pay?: number | null;
          allowances?: number | null;
          gross_pay?: number | null;
          deductions?: number | null;
          advance_recovery?: number | null;
          net_pay?: number | null;
          employee_id: number;
          food_deduction?: number;
          foreman?: string;
          hours?: number;
          id?: string;
          month: string;
          net_salary?: number;
          new_advance?: number;
          other_deduction?: number;
          paid?: number;
          prev_advance?: number;
          rate?: number;
        };
        Update: {
          batch_id?: string;
          created_at?: string;
          calculation_version?: string | null;
          regular_hours?: number | null;
          overtime_hours?: number | null;
          regular_pay?: number | null;
          overtime_pay?: number | null;
          allowances?: number | null;
          gross_pay?: number | null;
          deductions?: number | null;
          advance_recovery?: number | null;
          net_pay?: number | null;
          employee_id?: number;
          food_deduction?: number;
          foreman?: string;
          hours?: number;
          id?: string;
          month?: string;
          net_salary?: number;
          new_advance?: number;
          other_deduction?: number;
          paid?: number;
          prev_advance?: number;
          rate?: number;
        };
        Relationships: [
          {
            foreignKeyName: "payroll_lines_batch_id_fkey";
            columns: ["batch_id"];
            isOneToOne: false;
            referencedRelation: "payroll_batches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payroll_lines_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
        ];
      };
      timesheets: {
        Row: {
          id: string;
          employee_id: number;
          site: string;
          foreman: string;
          work_date: string;
          status: "PRESENT" | "ABSENT" | "LEAVE" | "HOLIDAY" | "WEEKLY_OFF" | "HALF_DAY";
          in_time: string | null;
          out_time: string | null;
          break_hours: number;
          total_hours: number | null;
          regular_hours: number;
          overtime_hours: number;
          remarks: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          employee_id: number;
          site: string;
          foreman: string;
          work_date: string;
          status?: "PRESENT" | "ABSENT" | "LEAVE" | "HOLIDAY" | "WEEKLY_OFF" | "HALF_DAY";
          in_time: string | null;
          out_time: string | null;
          break_hours?: number;
          overtime_hours?: number;
          remarks?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          employee_id?: number;
          site?: string;
          foreman?: string;
          work_date?: string;
          status?: "PRESENT" | "ABSENT" | "LEAVE" | "HOLIDAY" | "WEEKLY_OFF" | "HALF_DAY";
          in_time?: string | null;
          out_time?: string | null;
          break_hours?: number;
          overtime_hours?: number;
          remarks?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "timesheets_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
        ];
      };
      payroll_site_allocations: {
        Row: {
          id: string;
          payroll_line_id: string;
          employee_id: number;
          month: string;
          site: string;
          foreman: string;
          regular_hours: number;
          overtime_hours: number;
          allocated_regular_pay: number;
          allocated_overtime_pay: number;
          allocated_allowances: number;
          allocated_gross_cost: number;
          allocation_basis: string;
          calculation_version: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          payroll_line_id: string;
          employee_id: number;
          month: string;
          site: string;
          foreman?: string;
          regular_hours?: number;
          overtime_hours?: number;
          allocated_regular_pay?: number;
          allocated_overtime_pay?: number;
          allocated_allowances?: number;
          allocated_gross_cost?: number;
          allocation_basis: string;
          calculation_version?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          payroll_line_id?: string;
          employee_id?: number;
          month?: string;
          site?: string;
          foreman?: string;
          regular_hours?: number;
          overtime_hours?: number;
          allocated_regular_pay?: number;
          allocated_overtime_pay?: number;
          allocated_allowances?: number;
          allocated_gross_cost?: number;
          allocation_basis?: string;
          calculation_version?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payroll_site_allocations_payroll_line_id_fkey";
            columns: ["payroll_line_id"];
            isOneToOne: false;
            referencedRelation: "payroll_lines";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payroll_site_allocations_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_logs: {
        Row: {
          actor_email: string | null;
          actor_id: string | null;
          changed_at: string;
          id: string;
          new_data: Json | null;
          old_data: Json | null;
          operation: string;
          record_id: string | null;
          table_name: string;
        };
        Insert: {
          actor_email?: string | null;
          actor_id?: string | null;
          changed_at?: string;
          id?: string;
          new_data?: Json | null;
          old_data?: Json | null;
          operation: string;
          record_id?: string | null;
          table_name: string;
        };
        Update: {
          actor_email?: string | null;
          actor_id?: string | null;
          changed_at?: string;
          id?: string;
          new_data?: Json | null;
          old_data?: Json | null;
          operation?: string;
          record_id?: string | null;
          table_name?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      payroll_advance_balances_before: {
        Args: { target_month: string };
        Returns: { employee_id: number; balance: number }[];
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
