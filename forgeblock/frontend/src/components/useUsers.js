import { useEffect, useState } from 'react'
import { api } from '../api'

// Admin only: the user list (optionally one role) for filter dropdowns.
export function useUsers({ role, enabled = true } = {}) {
  const [users, setUsers] = useState([])
  useEffect(() => {
    if (!enabled) return
    api.get(`/api/admin/users${role ? `?role=${role}` : ''}`).then(setUsers).catch(() => setUsers([]))
  }, [role, enabled])
  return users
}
