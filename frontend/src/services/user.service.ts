export type ManagedUser = { id:number; name:string; username:string; role:"HD"|"ADMIN"|"SUPER_ADMIN"; city_id:number; city_name:string; is_active:boolean; segment_ids:number[]; segments:string }
export type UserOptions = { cities:Array<{id:number;name:string}>; segments:Array<{id:number;code:string}>; roles:string[] }
export type UserPayload = { name:string; username:string; password?:string; role:string; city_id:number; is_active:boolean; segment_ids:number[] }

async function request<T>(token:string, path:string, init:RequestInit = {}): Promise<T> {
  const response = await fetch(`http://localhost:3090/api/users${path}`, { ...init, headers:{ Authorization:`Bearer ${token}`, "Content-Type":"application/json", ...(init.headers || {}) } })
  const result = await response.json()
  if (!response.ok) throw new Error(result.message || "Gagal memproses user")
  return result.data as T
}

export function getManagedUsers(token:string, filters:{cityId?:string;search?:string} = {}) {
  const query = new URLSearchParams(); if(filters.cityId) query.set("city_id",filters.cityId); if(filters.search) query.set("search",filters.search)
  return request<ManagedUser[]>(token, `/${query.toString() ? `?${query}` : ""}`)
}
export function getUserOptions(token:string) { return request<UserOptions>(token,"/options") }
export function createManagedUser(token:string,payload:UserPayload) { return request<{id:number}>(token,"/",{method:"POST",body:JSON.stringify(payload)}) }
export function updateManagedUser(token:string,id:number,payload:UserPayload) { return request<{id:number}>(token,`/${id}`,{method:"PATCH",body:JSON.stringify(payload)}) }
export function resetManagedPassword(token:string,id:number,password:string) { return request<void>(token,`/${id}/reset-password`,{method:"POST",body:JSON.stringify({password})}) }
