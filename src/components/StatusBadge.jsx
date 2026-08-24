const StatusBadge = ({ status }) => {
  const statusColors = {
    registered: 'bg-gray-500',
    in_progress: 'bg-blue-500',
    approval_requested: 'bg-yellow-500',
    approved: 'bg-green-500',
    submitted: 'bg-purple-500'
  };

  const statusLabels = {
    registered: 'Registered',
    in_progress: 'Joined',
    approval_requested: 'Pending Approval',
    approved: 'Approved',
    submitted: 'Submitted'
  };

  const colorClass = statusColors[status] || 'bg-gray-500';
  const label = statusLabels[status] || status;

  return (
    <span className={`px-3 py-1 rounded-full text-white text-sm font-medium ${colorClass}`}>
      {label}
    </span>
  );
};

export default StatusBadge;

