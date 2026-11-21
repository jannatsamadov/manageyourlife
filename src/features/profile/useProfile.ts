// The signed-in person's profile row (P-70 item 10, T-113; table `profiles`): for now the birth date of the Chronos
// Timer. It used to live in this browser's settings — handed over to the profile once, then dropped there.
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { dropOldBirthdate, oldBirthdate } from "@/lib/settings";

export type Profile = { birth_date: string | null };

export function useProfile() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = ["profile", user?.id];

  const query = useQuery({
    queryKey: key,
    enabled: !!user,
    queryFn: async (): Promise<Profile> => {
      const { data, error } = await supabase.from("profiles").select("birth_date").eq("user_id", user!.id).maybeSingle();
      if (error) throw error;
      return data ?? { birth_date: null };
    },
  });

  const save = useMutation({
    mutationFn: async (p: Profile) => {
      const { error } = await supabase.from("profiles").upsert({ user_id: user!.id, ...p }, { onConflict: "user_id" });
      if (error) throw error;
      return p;
    },
    onSuccess: (p) => qc.setQueryData(key, p),
  });

  // the birth date from the old settings, once
  const loaded = query.data;
  useEffect(() => {
    const old = oldBirthdate();
    if (!loaded || !old) return;
    if (loaded.birth_date) dropOldBirthdate();
    else save.mutateAsync({ birth_date: old }).then(dropOldBirthdate, () => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  return { profile: query.data, loading: query.isLoading, save: save.mutateAsync };
}
