export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18";
  };
  public: {
    Tables: {
      club_memberships: {
        Row: {
          club_id: string;
          role: string;
          user_id: string;
        };
        Insert: {
          club_id: string;
          role: string;
          user_id: string;
        };
        Update: {
          club_id?: string;
          role?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "club_memberships_club_id_fkey";
            columns: ["club_id"];
            isOneToOne: false;
            referencedRelation: "clubs";
            referencedColumns: ["id"];
          },
        ];
      };
      clubs: {
        Row: {
          id: string;
          name: string;
          timezone: string;
        };
        Insert: {
          id?: string;
          name: string;
          timezone?: string;
        };
        Update: {
          id?: string;
          name?: string;
          timezone?: string;
        };
        Relationships: [];
      };
      match_drafts: {
        Row: {
          base_revision: number;
          club_id: string;
          editor_id: string;
          match_id: string;
          payload: Json;
          updated_at: string;
        };
        Insert: {
          base_revision: number;
          club_id: string;
          editor_id: string;
          match_id: string;
          payload: Json;
          updated_at?: string;
        };
        Update: {
          base_revision?: number;
          club_id?: string;
          editor_id?: string;
          match_id?: string;
          payload?: Json;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "match_drafts_match_id_club_id_fkey";
            columns: ["match_id", "club_id"];
            isOneToOne: false;
            referencedRelation: "matches";
            referencedColumns: ["id", "club_id"];
          },
        ];
      };
      match_player_stats: {
        Row: {
          appeared: boolean;
          assists: number | null;
          club_id: string;
          goals: number;
          match_id: string;
          player_id: string;
        };
        Insert: {
          appeared?: boolean;
          assists?: number | null;
          club_id: string;
          goals?: number;
          match_id: string;
          player_id: string;
        };
        Update: {
          appeared?: boolean;
          assists?: number | null;
          club_id?: string;
          goals?: number;
          match_id?: string;
          player_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "match_player_stats_match_id_club_id_fkey";
            columns: ["match_id", "club_id"];
            isOneToOne: false;
            referencedRelation: "matches";
            referencedColumns: ["id", "club_id"];
          },
          {
            foreignKeyName: "match_player_stats_player_id_club_id_fkey";
            columns: ["player_id", "club_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["id", "club_id"];
          },
        ];
      };
      match_results: {
        Row: {
          assists: string;
          attendance: string;
          away: number;
          basis: string;
          club_id: string;
          editor_id: string | null;
          home: number;
          match_id: string;
          on_field_away: number;
          on_field_home: number;
          own_goals: number;
          published: boolean;
          reason: string;
          scorers: string;
          updated_at: string;
        };
        Insert: {
          assists: string;
          attendance: string;
          away: number;
          basis: string;
          club_id: string;
          editor_id?: string | null;
          home: number;
          match_id: string;
          on_field_away: number;
          on_field_home: number;
          own_goals: number;
          published?: boolean;
          reason?: string;
          scorers: string;
          updated_at?: string;
        };
        Update: {
          assists?: string;
          attendance?: string;
          away?: number;
          basis?: string;
          club_id?: string;
          editor_id?: string | null;
          home?: number;
          match_id?: string;
          on_field_away?: number;
          on_field_home?: number;
          own_goals?: number;
          published?: boolean;
          reason?: string;
          scorers?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "match_results_match_id_club_id_fkey";
            columns: ["match_id", "club_id"];
            isOneToOne: false;
            referencedRelation: "matches";
            referencedColumns: ["id", "club_id"];
          },
        ];
      };
      matches: {
        Row: {
          league_fixture_override: boolean;
          club_id: string;
          color: string;
          home: boolean;
          id: string;
          kickoff: string | null;
          opponent: string;
          opponent_code: string;
          revision: number;
          round: number;
          season_id: string;
          source_timezone: string;
          status: string;
          venue: string;
        };
        Insert: {
          league_fixture_override?: boolean;
          club_id: string;
          color?: string;
          home?: boolean;
          id?: string;
          kickoff?: string | null;
          opponent: string;
          opponent_code: string;
          revision?: number;
          round: number;
          season_id: string;
          source_timezone?: string;
          status?: string;
          venue: string;
        };
        Update: {
          league_fixture_override?: boolean;
          club_id?: string;
          color?: string;
          home?: boolean;
          id?: string;
          kickoff?: string | null;
          opponent?: string;
          opponent_code?: string;
          revision?: number;
          round?: number;
          season_id?: string;
          source_timezone?: string;
          status?: string;
          venue?: string;
        };
        Relationships: [
          {
            foreignKeyName: "matches_season_id_club_id_fkey";
            columns: ["season_id", "club_id"];
            isOneToOne: false;
            referencedRelation: "seasons";
            referencedColumns: ["id", "club_id"];
          },
        ];
      };
      pending_captain_invites: {
        Row: {
          club_id: string;
          created_at: string;
          email: string;
        };
        Insert: {
          club_id: string;
          created_at?: string;
          email: string;
        };
        Update: {
          club_id?: string;
          created_at?: string;
          email?: string;
        };
        Relationships: [
          {
            foreignKeyName: "pending_captain_invites_club_id_fkey";
            columns: ["club_id"];
            isOneToOne: false;
            referencedRelation: "clubs";
            referencedColumns: ["id"];
          },
        ];
      };
      players: {
        Row: {
          bio: string;
          club_id: string;
          hometown: string;
          id: string;
          initials: string;
          is_public: boolean;
          name: string;
          number: number;
          position: string;
        };
        Insert: {
          bio?: string;
          club_id: string;
          hometown?: string;
          id?: string;
          initials: string;
          is_public?: boolean;
          name: string;
          number: number;
          position: string;
        };
        Update: {
          bio?: string;
          club_id?: string;
          hometown?: string;
          id?: string;
          initials?: string;
          is_public?: boolean;
          name?: string;
          number?: number;
          position?: string;
        };
        Relationships: [
          {
            foreignKeyName: "players_club_id_fkey";
            columns: ["club_id"];
            isOneToOne: false;
            referencedRelation: "clubs";
            referencedColumns: ["id"];
          },
        ];
      };
      result_history: {
        Row: {
          after_value: Json;
          before_value: Json | null;
          club_id: string;
          edited_at: string;
          editor_id: string;
          id: string;
          match_id: string;
        };
        Insert: {
          after_value: Json;
          before_value?: Json | null;
          club_id: string;
          edited_at?: string;
          editor_id: string;
          id?: string;
          match_id: string;
        };
        Update: {
          after_value?: Json;
          before_value?: Json | null;
          club_id?: string;
          edited_at?: string;
          editor_id?: string;
          id?: string;
          match_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "result_history_match_id_club_id_fkey";
            columns: ["match_id", "club_id"];
            isOneToOne: false;
            referencedRelation: "matches";
            referencedColumns: ["id", "club_id"];
          },
        ];
      };
      season_roster: {
        Row: {
          club_id: string;
          player_id: string;
          season_id: string;
        };
        Insert: {
          club_id: string;
          player_id: string;
          season_id: string;
        };
        Update: {
          club_id?: string;
          player_id?: string;
          season_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "season_roster_player_id_club_id_fkey";
            columns: ["player_id", "club_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["id", "club_id"];
          },
          {
            foreignKeyName: "season_roster_season_id_club_id_fkey";
            columns: ["season_id", "club_id"];
            isOneToOne: false;
            referencedRelation: "seasons";
            referencedColumns: ["id", "club_id"];
          },
        ];
      };
      seasons: {
        Row: {
          club_id: string;
          competition: string;
          format: string;
          id: string;
          name: string;
        };
        Insert: {
          club_id: string;
          competition: string;
          format: string;
          id?: string;
          name: string;
        };
        Update: {
          club_id?: string;
          competition?: string;
          format?: string;
          id?: string;
          name?: string;
        };
        Relationships: [
          {
            foreignKeyName: "seasons_club_id_fkey";
            columns: ["club_id"];
            isOneToOne: false;
            referencedRelation: "clubs";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      public_player_season_totals: {
        Row: {
          appearances: number | null;
          assists: number | null;
          assists_recorded_matches: number | null;
          club_id: string | null;
          goals: number | null;
          player_id: string | null;
          season_id: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "match_player_stats_player_id_club_id_fkey";
            columns: ["player_id", "club_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["id", "club_id"];
          },
        ];
      };
      public_season_totals: {
        Row: {
          club_id: string | null;
          draws: number | null;
          goals_against: number | null;
          goals_for: number | null;
          losses: number | null;
          played: number | null;
          points: number | null;
          season_id: string | null;
          wins: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "matches_season_id_club_id_fkey";
            columns: ["season_id", "club_id"];
            isOneToOne: false;
            referencedRelation: "seasons";
            referencedColumns: ["id", "club_id"];
          },
        ];
      };
    };
    Functions: {
      apply_league_sync: {
        Args: { p_snapshot: Json; p_token: string };
        Returns: Json;
      };
      begin_league_sync: { Args: { p_token: string }; Returns: Json };
      fail_league_sync: { Args: { p_token: string }; Returns: undefined };
      request_league_sync: { Args: { p_club_id: string }; Returns: undefined };
      use_league_fixture: {
        Args: { p_expected_revision: number; p_match_id: string };
        Returns: undefined;
      };
      club_snapshot: {
        Args: { p_club_id: string; p_private: boolean };
        Returns: Json;
      };
      get_captain_club: { Args: { p_club_id: string }; Returns: Json };
      get_public_club: { Args: { p_club_id: string }; Returns: Json };
      is_captain: { Args: { p_club_id: string }; Returns: boolean };
      save_fixture: {
        Args: { p_club_id: string; p_fixture: Json };
        Returns: string;
      };
      save_match_result: {
        Args: {
          p_expected_revision: number;
          p_match_id: string;
          p_payload: Json;
        };
        Returns: undefined;
      };
      save_roster_player: {
        Args: { p_club_id: string; p_player: Json; p_season_id: string };
        Returns: string;
      };
      validate_result_payload: {
        Args: { p_match_id: string; p_payload: Json; p_publish: boolean };
        Returns: undefined;
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

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

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
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
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
