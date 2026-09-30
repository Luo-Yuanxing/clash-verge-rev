import {
  DeleteForeverRounded,
  UndoRounded,
  VerticalAlignBottomRounded,
  VerticalAlignTopRounded,
} from '@mui/icons-material'
import {
  Box,
  IconButton,
  ListItem,
  ListItemText,
  alpha,
  styled,
} from '@mui/material'

import { parseRule } from './rule-fields'

interface Props {
  type: 'prepend' | 'original' | 'delete' | 'append'
  ruleRaw: string
  onDelete: () => void
  onPrepend?: () => void
  onAppend?: () => void
  readOnly?: boolean
}

export const RuleItem = (props: Props) => {
  const { type, ruleRaw, onDelete, onPrepend, onAppend, readOnly } = props
  const isSortable = !readOnly && (type === 'prepend' || type === 'append')
  const { type: ruleType, host, policy: proxyPolicy } = parseRule(ruleRaw)

  return (
    <ListItem
      dense
      sx={({ palette }) => ({
        position: 'relative',
        background:
          type === 'original'
            ? palette.mode === 'dark'
              ? alpha(palette.background.paper, 0.3)
              : alpha(palette.grey[400], 0.3)
            : type === 'delete'
              ? alpha(palette.error.main, 0.3)
              : alpha(palette.success.main, 0.3),
        height: '100%',
        borderRadius: '8px',
      })}
    >
      <ListItemText
        data-sortable-handle
        sx={{ cursor: isSortable ? 'move' : undefined }}
        primary={
          <StyledPrimary
            title={host || '-'}
            sx={{ textDecoration: type === 'delete' ? 'line-through' : '' }}
          >
            {host || '-'}
          </StyledPrimary>
        }
        secondary={
          <ListItemTextChild
            sx={{
              width: '62%',
              overflow: 'hidden',
              display: 'flex',
              justifyContent: 'space-between',
              pt: '2px',
            }}
          >
            <Box sx={{ marginTop: '2px' }}>
              <StyledTypeBox>{ruleType}</StyledTypeBox>
            </Box>
            <StyledSubtitle sx={{ color: 'text.secondary' }}>
              {proxyPolicy}
            </StyledSubtitle>
          </ListItemTextChild>
        }
        slotProps={{
          secondary: {
            sx: {
              display: 'flex',
              alignItems: 'center',
              color: '#ccc',
            },
          },
        }}
      />
      {!readOnly && type === 'prepend' && (
        <IconButton onClick={onAppend}>
          <VerticalAlignBottomRounded />
        </IconButton>
      )}
      {!readOnly && type === 'append' && (
        <IconButton onClick={onPrepend}>
          <VerticalAlignTopRounded />
        </IconButton>
      )}
      {!readOnly && (
        <IconButton onClick={onDelete}>
          {type === 'delete' ? <UndoRounded /> : <DeleteForeverRounded />}
        </IconButton>
      )}
    </ListItem>
  )
}

const StyledPrimary = styled('div')`
  font-size: 15px;
  font-weight: 700;
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const StyledSubtitle = styled('span')`
  font-size: 13px;
  overflow: hidden;
  color: text.secondary;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const ListItemTextChild = styled('span')`
  display: block;
`

const StyledTypeBox = styled(ListItemTextChild)(({ theme }) => ({
  display: 'inline-block',
  border: '1px solid #ccc',
  borderColor: alpha(theme.palette.primary.main, 0.5),
  color: alpha(theme.palette.primary.main, 0.8),
  borderRadius: 4,
  fontSize: 10,
  padding: '0 4px',
  lineHeight: 1.5,
  marginRight: '8px',
}))
